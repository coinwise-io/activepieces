import { PlatformRole, UserIdentityProvider } from '@activepieces/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { authenticationService } from '../../../../src/app/authentication/authentication.service'
import { totp } from '../../../../src/app/authentication/mfa/totp'
import { userIdentityService } from '../../../../src/app/authentication/user-identity/user-identity-service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { userService } from '../../../../src/app/user/user-service'
import { createMockSignUpRequest } from '../../../helpers/mocks/authn'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const SSO_DOMAIN = 'corp.example'
const PASSWORD = 'correct-horse-battery'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    for (const table of ['flag', 'project', 'platform', 'user', 'user_identity']) {
        await databaseConnection().getRepository(table).createQueryBuilder().delete().execute()
    }
})

describe('Password sign-in when SSO is active', () => {
    it('lets an account outside the SSO domain use its password even with email sign-in off', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })

        const response = await signIn({ email: 'owner@breakglass.example' })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json()).toEqual({ mfaRequired: true, challengeToken: expect.any(String), enrollmentRequired: true })
        expect(response.json().token).toBeUndefined()
    })

    it('refuses the password of an account in the SSO domain when email sign-in is off', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
        await addMember({ platformId: owner.platformId, email: `alice@${SSO_DOMAIN}` })

        const response = await signIn({ email: `alice@${SSO_DOMAIN}` })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response.json().code).toBe('EMAIL_AUTH_DISABLED')
    })

    it('still asks the SSO-domain account for a second factor when email sign-in is on', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: true })
        await addMember({ platformId: owner.platformId, email: `alice@${SSO_DOMAIN}` })

        const response = await signIn({ email: `alice@${SSO_DOMAIN}` })

        expect(response.json().mfaRequired).toBe(true)
    })

    it('does not ask for a second factor while SSO is not active', async () => {
        await signUpOwner({ email: 'owner@breakglass.example' })

        const response = await signIn({ email: 'owner@breakglass.example' })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().token).toBeDefined()
    })
})

describe('Mandatory enrollment', () => {
    it('enrolls, returns recovery codes and a session, then asks for a code next time', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })

        const { challengeToken } = (await signIn({ email: 'owner@breakglass.example' })).json()
        const enroll = await post('/v1/authentication/mfa/enroll', { challengeToken })
        expect(enroll.statusCode).toBe(StatusCodes.OK)
        const { secret, otpauthUri } = enroll.json()
        expect(otpauthUri).toContain('otpauth://totp/')
        expect(otpauthUri).toContain(encodeURIComponent('owner@breakglass.example'))

        const wrong = await post('/v1/authentication/mfa/enroll/confirm', { challengeToken, code: wrongCode({ secret }) })
        expect(wrong.statusCode).toBe(StatusCodes.GONE)
        expect(wrong.json().code).toBe('INVALID_OTP')

        const confirmed = await post('/v1/authentication/mfa/enroll/confirm', { challengeToken, code: currentCode({ secret }) })
        expect(confirmed.statusCode).toBe(StatusCodes.OK)
        expect(confirmed.json().recoveryCodes).toHaveLength(10)
        expect(confirmed.json().authentication.token).toBeDefined()

        const reused = await post('/v1/authentication/mfa/enroll/confirm', { challengeToken, code: currentCode({ secret }) })
        expect(reused.json().code).toBe('MFA_CHALLENGE_EXPIRED')

        const next = await signIn({ email: 'owner@breakglass.example' })
        expect(next.json()).toEqual({ mfaRequired: true, challengeToken: expect.any(String), enrollmentRequired: false })
    })

    it('refuses to verify on a challenge that still needs enrollment', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
        const { challengeToken } = (await signIn({ email: 'owner@breakglass.example' })).json()

        const response = await post('/v1/authentication/mfa/verify', { challengeToken, code: '123456' })

        expect(response.statusCode).toBe(StatusCodes.CONFLICT)
    })
})

describe('Second-factor verification', () => {
    it('signs in with a fresh code and refuses the code that was already used', async () => {
        const { secret } = await enrolledBreakGlassOwner()
        const usedAtEnrollment = currentCode({ secret })

        const replay = await verify({ code: usedAtEnrollment })
        expect(replay.json().code).toBe('INVALID_OTP')

        const fresh = await verify({ code: totp.codeAt({ secret, step: totp.stepAt({ nowMs: Date.now() }) + 1 }) })
        expect(fresh.statusCode).toBe(StatusCodes.OK)
        expect(fresh.json().token).toBeDefined()
        expect(fresh.json().email).toBe('owner@breakglass.example')
    })

    it('accepts each recovery code once', async () => {
        const { recoveryCodes } = await enrolledBreakGlassOwner()

        const first = await verify({ code: recoveryCodes[0].toUpperCase() })
        expect(first.statusCode).toBe(StatusCodes.OK)

        const second = await verify({ code: recoveryCodes[0] })
        expect(second.json().code).toBe('INVALID_OTP')

        const other = await verify({ code: recoveryCodes[1].replace('-', '') })
        expect(other.statusCode).toBe(StatusCodes.OK)
    })

    it('burns the challenge after five wrong codes', async () => {
        const { secret } = await enrolledBreakGlassOwner()
        const { challengeToken } = (await signIn({ email: 'owner@breakglass.example' })).json()

        for (let attempt = 0; attempt < 5; attempt++) {
            const wrong = await post('/v1/authentication/mfa/verify', { challengeToken, code: wrongCode({ secret }) })
            expect(wrong.json().code).toBe('INVALID_OTP')
        }
        const afterLimit = await post('/v1/authentication/mfa/verify', { challengeToken, code: futureCode({ secret }) })
        expect(afterLimit.json().code).toBe('MFA_CHALLENGE_EXPIRED')
    })

    it('rejects an unknown challenge', async () => {
        const response = await post('/v1/authentication/mfa/verify', { challengeToken: 'not-a-challenge', code: '123456' })
        expect(response.statusCode).toBe(StatusCodes.GONE)
        expect(response.json().code).toBe('MFA_CHALLENGE_EXPIRED')
    })
})

describe('Self-service two-factor', () => {
    it('sets up, ends older sessions, is then asked at sign-in, and turns off with a code', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })

        const before = await get({ url: '/v1/authentication/mfa/status', token: owner.token })
        expect(before.json()).toEqual({ enabled: false, requiredByPlatform: false, recoveryCodesRemaining: 0 })

        const { secret } = (await post('/v1/authentication/mfa/setup', {}, owner.token)).json()
        const confirmed = await post('/v1/authentication/mfa/setup/confirm', { code: currentCode({ secret }) }, owner.token)
        expect(confirmed.json().recoveryCodes).toHaveLength(10)

        const staleSession = await get({ url: '/v1/authentication/mfa/status', token: owner.token })
        expect(staleSession.json().code).toBe('SESSION_EXPIRED')

        const signInResponse = await signIn({ email: 'owner@breakglass.example' })
        expect(signInResponse.json()).toEqual({ mfaRequired: true, challengeToken: expect.any(String), enrollmentRequired: false })
        const session = await post('/v1/authentication/mfa/verify', { challengeToken: signInResponse.json().challengeToken, code: futureCode({ secret }) })
        const token = session.json().token

        const again = await post('/v1/authentication/mfa/setup', {}, token)
        expect(again.statusCode).toBe(StatusCodes.CONFLICT)

        const regenerated = await post('/v1/authentication/mfa/recovery-codes', { code: confirmed.json().recoveryCodes[0] }, token)
        expect(regenerated.json().recoveryCodes).toHaveLength(10)
        const oldCode = await post('/v1/authentication/mfa/disable', { code: confirmed.json().recoveryCodes[1] }, token)
        expect(oldCode.json().code).toBe('INVALID_OTP')

        const disabled = await post('/v1/authentication/mfa/disable', { code: regenerated.json().recoveryCodes[0] }, token)
        expect(disabled.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect((await get({ url: '/v1/authentication/mfa/status', token })).json().code).toBe('SESSION_EXPIRED')

        const after = await signIn({ email: 'owner@breakglass.example' })
        expect(after.json().token).toBeDefined()
    })

    it('ends sessions issued before a forced enrollment', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
        await enrollOwner()

        const staleSession = await get({ url: '/v1/authentication/mfa/status', token: owner.token })
        expect(staleSession.json().code).toBe('SESSION_EXPIRED')
    })

    it('does not let a second enrollment replace an existing one', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
        const attacker = (await signIn({ email: 'owner@breakglass.example' })).json()
        const { secret: attackerSecret } = (await post('/v1/authentication/mfa/enroll', { challengeToken: attacker.challengeToken })).json()

        const { secret } = await enrollOwner()

        const replaced = await post('/v1/authentication/mfa/enroll/confirm', { challengeToken: attacker.challengeToken, code: currentCode({ secret: attackerSecret }) })
        expect(replaced.statusCode).toBe(StatusCodes.CONFLICT)
        expect((await verify({ code: futureCode({ secret }) })).statusCode).toBe(StatusCodes.OK)
    })
})

describe('Admin reset', () => {
    it('lets a platform admin reset another user but not themselves', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        const member = await addMember({ platformId: owner.platformId, email: 'member@breakglass.example' })
        const memberSession = (await signIn({ email: 'member@breakglass.example' })).json()
        const { secret } = (await post('/v1/authentication/mfa/setup', {}, memberSession.token)).json()
        await post('/v1/authentication/mfa/setup/confirm', { code: currentCode({ secret }) }, memberSession.token)

        const enrolled = await get({ url: '/v1/authentication/mfa/users', token: owner.token })
        expect(enrolled.json().userIds).toEqual([member.id])

        const asMember = await app.inject({
            remoteAddress: faker.internet.ipv4(), method: 'DELETE', url: `/api/v1/authentication/mfa/users/${owner.id}`, headers: { authorization: `Bearer ${memberSession.token}` } })
        expect(asMember.statusCode).toBe(StatusCodes.FORBIDDEN)

        const self = await app.inject({
            remoteAddress: faker.internet.ipv4(), method: 'DELETE', url: `/api/v1/authentication/mfa/users/${owner.id}`, headers: { authorization: `Bearer ${owner.token}` } })
        expect(self.statusCode).toBe(StatusCodes.FORBIDDEN)

        const reset = await app.inject({
            remoteAddress: faker.internet.ipv4(), method: 'DELETE', url: `/api/v1/authentication/mfa/users/${member.id}`, headers: { authorization: `Bearer ${owner.token}` } })
        expect(reset.statusCode).toBe(StatusCodes.NO_CONTENT)

        const afterReset = await signIn({ email: 'member@breakglass.example' })
        expect(afterReset.json().token).toBeDefined()
    })
})

describe('SAML sessions', () => {
    it('are not asked for a second factor', async () => {
        const owner = await signUpOwner({ email: 'owner@breakglass.example' })
        await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
        const member = await addMember({ platformId: owner.platformId, email: `alice@${SSO_DOMAIN}` })

        const { response } = await authenticationService(app.log).federatedAuthn({
            email: `alice@${SSO_DOMAIN}`,
            firstName: 'Alice',
            lastName: 'Doe',
            newsLetter: false,
            trackEvents: false,
            provider: UserIdentityProvider.SAML,
            predefinedPlatformId: owner.platformId,
        })

        expect(response.id).toBe(member.id)
        expect(response.token).toBeDefined()
    })
})

async function signUpOwner({ email }: { email: string }): Promise<{ id: string, platformId: string, token: string }> {
    const response = await app.inject({
        remoteAddress: faker.internet.ipv4(),
        method: 'POST',
        url: '/api/v1/authentication/sign-up',
        body: createMockSignUpRequest({ email, password: PASSWORD }),
    })
    expect(response.statusCode).toBe(StatusCodes.OK)
    const body = response.json()
    return { id: body.id, platformId: body.platformId, token: body.token }
}

async function addMember({ platformId, email }: { platformId: string, email: string }): Promise<{ id: string }> {
    const identity = await userIdentityService(app.log).create({
        email,
        password: PASSWORD,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        trackEvents: false,
        newsLetter: false,
        provider: UserIdentityProvider.EMAIL,
        verified: true,
    })
    const user = await userService(app.log).create({ identityId: identity.id, platformId, platformRole: PlatformRole.MEMBER, externalId: undefined })
    return { id: user.id }
}

async function activateSso({ platformId, emailAuthEnabled }: { platformId: string, emailAuthEnabled: boolean }): Promise<void> {
    await databaseConnection().getRepository('platform').update({ id: platformId }, {
        emailAuthEnabled,
        federatedAuthProviders: { saml: { idpMetadata: '<EntityDescriptor/>', idpCertificate: 'cert' } },
        ssoDomain: SSO_DOMAIN,
        ssoDomainVerification: {
            status: 'VERIFIED',
            record: { type: 'TXT', name: `_ap-sso-verification.${SSO_DOMAIN}`, value: 'ap-sso-verification=x' },
            createdAt: new Date().toISOString(),
        },
    })
}

async function enrolledBreakGlassOwner(): Promise<{ secret: string, recoveryCodes: string[] }> {
    const owner = await signUpOwner({ email: 'owner@breakglass.example' })
    await activateSso({ platformId: owner.platformId, emailAuthEnabled: false })
    return enrollOwner()
}

async function enrollOwner(): Promise<{ secret: string, recoveryCodes: string[] }> {
    const { challengeToken } = (await signIn({ email: 'owner@breakglass.example' })).json()
    const { secret } = (await post('/v1/authentication/mfa/enroll', { challengeToken })).json()
    const confirmed = await post('/v1/authentication/mfa/enroll/confirm', { challengeToken, code: currentCode({ secret }) })
    return { secret, recoveryCodes: confirmed.json().recoveryCodes }
}

async function verify({ code }: { code: string }) {
    const { challengeToken } = (await signIn({ email: 'owner@breakglass.example' })).json()
    return post('/v1/authentication/mfa/verify', { challengeToken, code })
}

async function signIn({ email }: { email: string }) {
    return post('/v1/authentication/sign-in', { email, password: PASSWORD })
}

async function post(url: string, body: Record<string, unknown>, token?: string) {
    return app.inject({
        remoteAddress: faker.internet.ipv4(),
        method: 'POST',
        url: `/api${url}`,
        body,
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })
}

async function get({ url, token }: { url: string, token: string }) {
    return app.inject({
        remoteAddress: faker.internet.ipv4(), method: 'GET', url: `/api${url}`, headers: { authorization: `Bearer ${token}` } })
}

function currentCode({ secret }: { secret: string }): string {
    return totp.codeAt({ secret, step: totp.stepAt({ nowMs: Date.now() }) })
}

function futureCode({ secret }: { secret: string }): string {
    return totp.codeAt({ secret, step: totp.stepAt({ nowMs: Date.now() }) + 1 })
}

function wrongCode({ secret }: { secret: string }): string {
    const valid = new Set([-1, 0, 1].map((offset) => totp.codeAt({ secret, step: totp.stepAt({ nowMs: Date.now() }) + offset })))
    return ['000000', '111111', '222222', '333333'].find((code) => !valid.has(code)) ?? '444444'
}
