import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import * as samlify from 'samlify'
import { dnsTxtResolver } from '../../../../../src/app/authentication/saml/dns-txt-resolver'
import { samlSetup } from '../../../../../src/app/authentication/saml/saml-setup'
import { databaseConnection } from '../../../../../src/app/database/database-connection'
import { platformService } from '../../../../../src/app/platform/platform.service'
import { createMemberContext, createTestContext, TestContext } from '../../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
    samlSetup.ensureSchemaValidator()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('SAML configuration', () => {
    it('rejects metadata that is neither XML nor an https URL', async () => {
        const ctx = await createTestContext(app)
        const response = await saveSaml({ ctx, idpMetadata: 'not xml at all', idpCertificate: IDP_CERT })
        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('rejects XML that is not an IdP descriptor', async () => {
        const ctx = await createTestContext(app)
        const response = await saveSaml({ ctx, idpMetadata: '<foo/>', idpCertificate: IDP_CERT })
        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('rejects a plain http metadata URL', async () => {
        const ctx = await createTestContext(app)
        const response = await saveSaml({ ctx, idpMetadata: 'http://idp.example.com/metadata', idpCertificate: IDP_CERT })
        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('rejects a bad certificate', async () => {
        const ctx = await createTestContext(app)
        const response = await saveSaml({ ctx, idpMetadata: buildIdpMetadata(), idpCertificate: 'definitely not a certificate' })
        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
        const validBase64ButNotX509 = await saveSaml({ ctx, idpMetadata: buildIdpMetadata(), idpCertificate: Buffer.from('hello').toString('base64') })
        expect(validBase64ButNotX509.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('accepts a valid pair and normalizes a bare base64 certificate to PEM', async () => {
        const ctx = await createTestContext(app)
        const bare = IDP_CERT.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
        const response = await saveSaml({ ctx, idpMetadata: buildIdpMetadata(), idpCertificate: bare })
        expect(response.statusCode).toBe(StatusCodes.OK)
        const stored = await platformService(app.log).getOneWithFederatedAuthOrThrow(ctx.platform.id)
        expect(stored.federatedAuthProviders.saml?.idpCertificate).toContain('-----BEGIN CERTIFICATE-----')
    })

    it('clears the configuration when saml is null', async () => {
        const ctx = await createSamlPlatform()
        const response = await ctx.post(`/v1/platforms/${ctx.platform.id}`, { federatedAuthProviders: { saml: null } })
        expect(response.statusCode).toBe(StatusCodes.OK)
        const stored = await platformService(app.log).getOneWithFederatedAuthOrThrow(ctx.platform.id)
        expect(stored.federatedAuthProviders.saml).toBeNull()
    })
})

describe('SAML login', () => {
    it('redirects to the IdP with SAMLRequest and RelayState', async () => {
        const ctx = await createSamlPlatform()
        const response = await app.inject({ method: 'GET', url: '/api/v1/authn/saml/login', query: { platformId: ctx.platform.id } })
        expect(response.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        const location = new URL(response.headers.location as string)
        expect(location.origin + location.pathname).toBe(IDP_SSO_URL)
        expect(location.searchParams.get('SAMLRequest')).toBeTruthy()
        expect(location.searchParams.get('RelayState')).toBe(ctx.platform.id)
    })

    it('sends the browser back to sign-in when SAML is not configured', async () => {
        const ctx = await createTestContext(app)
        const response = await app.inject({ method: 'GET', url: '/api/v1/authn/saml/login', query: { platformId: ctx.platform.id } })
        expect(response.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        expect(response.headers.location).toMatch(/\/sign-in$/)
    })
})

describe('SAML ACS', () => {
    it('logs in an existing user and lets the code be claimed exactly once with the nonce cookie', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse, nonce } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        const location = new URL(acs.headers.location as string)
        expect(location.pathname).toBe('/authenticate')
        const code = location.searchParams.get('code')
        expect(code).toBeTruthy()

        const first = await claim({ code, nonce })
        expect(first.statusCode).toBe(StatusCodes.OK)
        const body = first.json()
        expect(body.token).toBeTruthy()
        expect(body.email).toBe(ctx.userIdentity.email)
        expect(body.platformId).toBe(ctx.platform.id)
        expect(String(first.headers['set-cookie'])).toContain('Max-Age=0')

        const second = await claim({ code, nonce })
        expect(second.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects a claim without the nonce cookie', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        const code = new URL(acs.headers.location as string).searchParams.get('code')
        const response = await claim({ code, nonce: null })
        expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects a claim with the wrong nonce cookie', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        const code = new URL(acs.headers.location as string).searchParams.get('code')
        const response = await claim({ code, nonce: 'someone-elses-nonce' })
        expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects an unknown claim code', async () => {
        const response = await claim({ code: 'nope', nonce: 'x' })
        expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('sets a hardened nonce cookie at login', async () => {
        const ctx = await createSamlPlatform()
        const response = await app.inject({ method: 'GET', url: '/api/v1/authn/saml/login', query: { platformId: ctx.platform.id } })
        const cookie = String(response.headers['set-cookie'])
        expect(cookie).toContain('ap_saml_nonce=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Path=/api/v1/authn/saml')
        expect(cookie).toContain('Max-Age=600')
    })

    it('redirects to sign-in when the response was tampered with', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const xml = Buffer.from(samlResponse, 'base64').toString('utf8')
        const tampered = Buffer.from(xml.replace(ctx.userIdentity.email, `attacker-${ctx.userIdentity.email}`)).toString('base64')
        const acs = await postAcs({ samlResponse: tampered, relayState: ctx.platform.id })
        expect(acs.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('redirects to sign-in when the response is unsigned', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx, signed: false })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('redirects to sign-in when the response is signed by a different key', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx, privateKey: OTHER_KEY, cert: OTHER_CERT })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses an unsolicited response that answers no known login request', async () => {
        const ctx = await createSamlPlatform()
        const samlResponse = await buildSamlResponse({ email: ctx.userIdentity.email, inResponseTo: '_never-issued' })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses an IdP-initiated response with an empty InResponseTo', async () => {
        const ctx = await createSamlPlatform()
        const samlResponse = await buildSamlResponse({ email: ctx.userIdentity.email, inResponseTo: '' })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses a response when RelayState names another platform', async () => {
        const ctx = await createSamlPlatform()
        const other = await createSamlPlatform({ verifyDomain: false })
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: other.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses a replayed response', async () => {
        const ctx = await createSamlPlatform()
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const first = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(new URL(first.headers.location as string).pathname).toBe('/authenticate')
        const replay = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(replay.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses a login when no sso domain is set', async () => {
        const ctx = await createSamlPlatform({ verifyDomain: false })
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses a login when the sso domain is only pending', async () => {
        const ctx = await createSamlPlatform({ verifyDomain: false })
        await setSsoDomain({ platformId: ctx.platform.id, domain: 'example.com', status: 'PENDING_VERIFICATION' })
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })

    it('refuses an email outside the verified sso domain', async () => {
        const ctx = await createSamlPlatform()
        await setSsoDomain({ platformId: ctx.platform.id, domain: 'corp.example.org', status: 'VERIFIED' })
        const { samlResponse } = await startLoginAndRespond({ ctx })
        const acs = await postAcs({ samlResponse, relayState: ctx.platform.id })
        expect(acs.statusCode).toBe(StatusCodes.MOVED_TEMPORARILY)
        expect(acs.headers.location).toMatch(/\/sign-in$/)
    })
})

describe('SSO domain', () => {
    it('sets a pending domain, verifies it through DNS, and discovers the platform', async () => {
        const ctx = await createSamlPlatform()
        const domain = `acme-${Date.now()}.example.com`

        const set = await ctx.post('/v1/authn/saml/sso-domain', { ssoDomain: domain })
        expect(set.statusCode).toBe(StatusCodes.OK)
        const state = set.json()
        expect(state.ssoDomain).toBe(domain)
        expect(state.ssoDomainVerification.status).toBe('PENDING_VERIFICATION')
        expect(state.ssoDomainVerification.record.name).toBe(`_ap-sso-verification.${domain}`)
        expect(state.ssoDomainVerification.record.value).toMatch(/^ap-sso-verification=/)

        const beforeDiscover = await app.inject({ method: 'POST', url: '/api/v1/authn/saml/discover', body: { domain } })
        expect(beforeDiscover.json()).toEqual({ platformId: null })

        const lookup = vi.spyOn(dnsTxtResolver, 'lookup').mockResolvedValueOnce(['unrelated'])
        const stillPending = await ctx.post('/v1/authn/saml/sso-domain/verify')
        expect(stillPending.statusCode).toBe(StatusCodes.OK)
        expect(stillPending.json().ssoDomainVerification.status).toBe('PENDING_VERIFICATION')

        lookup.mockResolvedValueOnce([state.ssoDomainVerification.record.value])
        const verified = await ctx.post('/v1/authn/saml/sso-domain/verify')
        expect(verified.json().ssoDomainVerification.status).toBe('VERIFIED')

        const afterDiscover = await app.inject({ method: 'POST', url: '/api/v1/authn/saml/discover', body: { domain } })
        expect(afterDiscover.json()).toEqual({ platformId: ctx.platform.id })
    })

    it('clears the domain with null', async () => {
        const ctx = await createSamlPlatform()
        await ctx.post('/v1/authn/saml/sso-domain', { ssoDomain: `clear-${Date.now()}.example.com` })
        const cleared = await ctx.post('/v1/authn/saml/sso-domain', { ssoDomain: null })
        expect(cleared.json()).toEqual({ ssoDomain: null, ssoDomainVerification: null })
    })

    it('rejects a malformed domain', async () => {
        const ctx = await createSamlPlatform()
        const response = await ctx.post('/v1/authn/saml/sso-domain', { ssoDomain: 'not a domain' })
        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('rejects a domain claimed by another platform', async () => {
        const domain = `shared-${Date.now()}.example.com`
        const first = await createSamlPlatform()
        const second = await createSamlPlatform()
        expect((await first.post('/v1/authn/saml/sso-domain', { ssoDomain: domain })).statusCode).toBe(StatusCodes.OK)
        const response = await second.post('/v1/authn/saml/sso-domain', { ssoDomain: domain })
        expect(response.statusCode).not.toBe(StatusCodes.OK)
    })

    it('does not discover a verified domain without SAML configured', async () => {
        const domain = `nosaml-${Date.now()}.example.com`
        const ctx = await createTestContext(app)
        await databaseConnection().getRepository('platform').update({ id: ctx.platform.id }, {
            ssoDomain: domain,
            ssoDomainVerification: {
                status: 'VERIFIED',
                record: { type: 'TXT', name: `_ap-sso-verification.${domain}`, value: 'ap-sso-verification=x' },
                createdAt: new Date().toISOString(),
            },
        })
        const response = await app.inject({ method: 'POST', url: '/api/v1/authn/saml/discover', body: { domain } })
        expect(response.json()).toEqual({ platformId: null })
    })

    it('forbids non-admins on the sso-domain routes', async () => {
        const ctx = await createSamlPlatform()
        const member = await createMemberContext(app, ctx, { projectRole: 'EDITOR' })
        const set = await member.post('/v1/authn/saml/sso-domain', { ssoDomain: 'member.example.com' })
        expect(set.statusCode).toBe(StatusCodes.FORBIDDEN)
        const verify = await member.post('/v1/authn/saml/sso-domain/verify')
        expect(verify.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('refuses unauthenticated calls on the sso-domain routes', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/authn/saml/sso-domain/verify' })
        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})

async function createSamlPlatform({ verifyDomain = true }: CreateSamlPlatformParams = {}): Promise<TestContext> {
    const ctx = await createTestContext(app, { platform: { emailAuthEnabled: true } })
    const response = await saveSaml({ ctx, idpMetadata: buildIdpMetadata(), idpCertificate: IDP_CERT })
    expect(response.statusCode).toBe(StatusCodes.OK)
    if (verifyDomain) {
        await setSsoDomain({ platformId: ctx.platform.id, domain: 'example.com', status: 'VERIFIED' })
    }
    return ctx
}

async function setSsoDomain({ platformId, domain, status }: SetSsoDomainParams): Promise<void> {
    const repo = databaseConnection().getRepository('platform')
    await repo.update({ ssoDomain: domain }, { ssoDomain: null, ssoDomainVerification: null })
    await repo.update({ id: platformId }, {
        ssoDomain: domain,
        ssoDomainVerification: {
            status,
            record: { type: 'TXT', name: `_ap-sso-verification.${domain}`, value: 'ap-sso-verification=x' },
            createdAt: new Date().toISOString(),
        },
    })
}

async function startLoginAndRespond({ ctx, signed, privateKey, cert }: StartLoginAndRespondParams): Promise<LoginAndResponse> {
    const login = await app.inject({ method: 'GET', url: '/api/v1/authn/saml/login', query: { platformId: ctx.platform.id } })
    const location = new URL(login.headers.location as string)
    const requestXml = inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest') as string, 'base64')).toString('utf8')
    const requestId = /ID="([^"]+)"/.exec(requestXml)?.[1] as string
    const nonce = /ap_saml_nonce=([^;]+)/.exec(String(login.headers['set-cookie']))?.[1] as string
    const samlResponse = await buildSamlResponse({ email: ctx.userIdentity.email, inResponseTo: requestId, signed, privateKey, cert })
    return { samlResponse, nonce, requestId }
}

async function claim({ code, nonce }: ClaimParams) {
    return app.inject({
        method: 'POST',
        url: '/api/v1/authn/saml/claim',
        headers: nonce === null ? {} : { cookie: `ap_saml_nonce=${nonce}` },
        body: { code },
    })
}

async function saveSaml({ ctx, idpMetadata, idpCertificate }: SaveSamlParams) {
    return ctx.post(`/v1/platforms/${ctx.platform.id}`, {
        federatedAuthProviders: { saml: { idpMetadata, idpCertificate } },
    })
}

function buildIdpMetadata(): string {
    return samlify.IdentityProvider({
        entityID: IDP_ENTITY_ID,
        signingCert: IDP_CERT,
        singleSignOnService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: IDP_SSO_URL }],
    }).getMetadata()
}

async function buildSamlResponse({ email, inResponseTo, signed = true, privateKey = IDP_KEY, cert = IDP_CERT }: BuildSamlResponseParams): Promise<string> {
    const idp = samlify.IdentityProvider({
        entityID: IDP_ENTITY_ID,
        privateKey,
        signingCert: cert,
        singleSignOnService: [{ Binding: samlify.Constants.namespace.binding.redirect, Location: IDP_SSO_URL }],
    })
    const sp = samlify.ServiceProvider({
        entityID: 'Activepieces',
        wantAssertionsSigned: true,
        assertionConsumerService: [{ Binding: samlify.Constants.namespace.binding.post, Location: ACS_URL }],
    })
    const result = await idp.createLoginResponse(sp, { extract: { request: { id: inResponseTo } } }, 'post', { email })
    return signed ? result.context : stripSignatures({ encoded: result.context })
}

async function postAcs({ samlResponse, relayState }: PostAcsParams) {
    return app.inject({
        method: 'POST',
        url: '/api/v1/authn/saml/acs',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }).toString(),
    })
}

function stripSignatures({ encoded }: StripSignaturesParams): string {
    const xml = Buffer.from(encoded, 'base64').toString('utf8')
    return Buffer.from(xml.replace(/<(\w+:)?Signature[\s\S]*?<\/(\w+:)?Signature>/g, '')).toString('base64')
}

function readFixture(name: string): string {
    return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}

const IDP_CERT = readFixture('idp-cert.pem')
const IDP_KEY = readFixture('idp-key.pem')
const OTHER_CERT = readFixture('other-cert.pem')
const OTHER_KEY = readFixture('other-key.pem')
const IDP_ENTITY_ID = 'https://idp.example.com/entity'
const IDP_SSO_URL = 'https://idp.example.com/sso'
const ACS_URL = 'http://localhost:4200/api/v1/authn/saml/acs'

type SaveSamlParams = {
    ctx: TestContext
    idpMetadata: string
    idpCertificate: string
}

type BuildSamlResponseParams = {
    email: string
    inResponseTo: string
    signed?: boolean
    privateKey?: string
    cert?: string
}

type StripSignaturesParams = {
    encoded: string
}

type CreateSamlPlatformParams = {
    verifyDomain?: boolean
}

type SetSsoDomainParams = {
    platformId: string
    domain: string
    status: 'VERIFIED' | 'PENDING_VERIFICATION'
}

type StartLoginAndRespondParams = {
    ctx: TestContext
    signed?: boolean
    privateKey?: string
    cert?: string
}

type LoginAndResponse = {
    samlResponse: string
    nonce: string
    requestId: string
}

type ClaimParams = {
    code: string | null
    nonce: string | null
}

type PostAcsParams = {
    samlResponse: string
    relayState: string
}
