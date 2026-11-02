import { ActivepiecesError, ErrorCode, isNil, PlatformId, tryCatch } from '@activepieces/core-utils'
import { AuthenticationResponse, SAMLAttributeMapping, SAMLAuthnProviderConfig, UserIdentityProvider } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import * as samlify from 'samlify'
import { domainHelper } from '../../helper/domain-helper'
import { platformService } from '../../platform/platform.service'
import { authenticationService } from '../authentication.service'
import { samlConfigValidator, SsoBinding } from './saml-config-validator'
import { samlLoginCodeStore } from './saml-login-code-store'
import { samlRequestStore } from './saml-request-store'
import { samlSetup } from './saml-setup'

export const samlService = (log: FastifyBaseLogger) => ({
    async startLogin({ platformId }: BuildLoginUrlParams): Promise<SamlLoginStart> {
        const config = await getSamlConfigOrThrow({ platformId, log })
        const { sp, idp, binding } = await buildEntities({ config })
        const request = sp.createLoginRequest(idp, binding, { relayState: platformId })
        const nonce = await samlRequestStore.record({ requestId: request.id, platformId })
        if (binding === 'redirect') {
            return { binding, loginUrl: request.context, nonce }
        }
        const actionUrl = 'entityEndpoint' in request ? request.entityEndpoint : undefined
        if (typeof actionUrl !== 'string' || actionUrl.length === 0) {
            throw new Error('SAML POST login request has no IdP endpoint')
        }
        return { binding, actionUrl, samlRequest: request.context, relayState: platformId, nonce }
    },

    async completeLogin({ platformId, samlResponse }: CompleteLoginParams): Promise<string> {
        const config = await getSamlConfigOrThrow({ platformId, log })
        const { sp, idp } = await buildEntities({ config })
        samlSetup.ensureSchemaValidator()
        const parsed = await sp.parseLoginResponse(idp, 'post', { body: { SAMLResponse: samlResponse } })
        const audience = parsed.extract.audience
        const audienceMatches = Array.isArray(audience) ? audience.includes(SP_ENTITY_ID) : audience === SP_ENTITY_ID
        if (!audienceMatches) {
            throw invalidResponse({ message: 'Assertion audience does not match the service provider' })
        }
        const acsUrl = await domainHelper.getPublicApiUrl({ path: ACS_PATH })
        const details = readAssertionDetails({ extract: parsed.extract, samlContent: parsed.samlContent, acsUrl })
        const pending = await samlRequestStore.consume({ requestId: details.inResponseTo })
        if (isNil(pending) || pending.platformId !== platformId) {
            throw invalidResponse({ message: 'Response does not answer a login request issued for this platform' })
        }
        const firstSeen = await samlRequestStore.markAssertionSeen({
            assertionId: details.assertionId,
            ttlSeconds: replayTtlSeconds({ notOnOrAfter: details.notOnOrAfter }),
        })
        if (!firstSeen) {
            throw invalidResponse({ message: 'Assertion has already been used' })
        }
        const profile = readProfile({ extract: parsed.extract, attributeMapping: config.attributeMapping })
        if (isNil(profile)) {
            throw invalidResponse({ message: 'Assertion has no email address' })
        }
        const { response } = await authenticationService(log).federatedAuthn({
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            newsLetter: false,
            trackEvents: true,
            provider: UserIdentityProvider.SAML,
            predefinedPlatformId: pending.platformId,
        })
        return samlLoginCodeStore.issue({ response, nonce: pending.nonce })
    },

    async claim({ code, nonce }: ClaimParams): Promise<AuthenticationResponse> {
        const issued = await samlLoginCodeStore.claim({ code })
        if (isNil(issued) || isNil(nonce) || issued.nonce !== nonce) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHENTICATION,
                params: { message: 'The sign-in code is invalid or has expired' },
            })
        }
        return issued.response
    },
})

async function getSamlConfigOrThrow({ platformId, log }: GetSamlConfigParams): Promise<SAMLAuthnProviderConfig> {
    const { data: platform, error } = await tryCatch(() => platformService(log).getOneWithFederatedAuthOrThrow(platformId))
    const config = platform?.federatedAuthProviders?.saml
    if (!isNil(error) || isNil(config)) {
        throw invalidResponse({ message: 'SAML is not configured for this platform' })
    }
    return config
}

async function buildEntities({ config }: BuildEntitiesParams): Promise<Entities> {
    samlSetup.ensureSchemaValidator()
    const descriptor = samlConfigValidator.extractIdpDescriptor({ idpMetadata: config.idpMetadata })
    const idp = samlify.IdentityProvider({
        entityID: descriptor.entityId,
        signingCert: config.idpCertificate,
        wantAuthnRequestsSigned: false,
        nameIDFormat: [NAME_ID_FORMAT],
        singleSignOnService: [{
            Binding: samlify.Constants.namespace.binding[descriptor.singleSignOnBinding],
            Location: descriptor.singleSignOnUrl,
        }],
    })
    const acsUrl = await domainHelper.getPublicApiUrl({ path: ACS_PATH })
    const sp = samlify.ServiceProvider({
        entityID: SP_ENTITY_ID,
        authnRequestsSigned: false,
        wantAssertionsSigned: true,
        nameIDFormat: [NAME_ID_FORMAT],
        assertionConsumerService: [{
            Binding: samlify.Constants.namespace.binding.post,
            Location: acsUrl,
        }],
        clockDrifts: [-CLOCK_DRIFT_MS, CLOCK_DRIFT_MS],
    })
    return { sp, idp, binding: descriptor.singleSignOnBinding }
}

function readProfile({ extract, attributeMapping }: ReadProfileParams): SamlProfile | null {
    const attributes = extract.attributes ?? {}
    const email = firstAttribute({ attributes, names: withMapped({ mapped: attributeMapping?.email, defaults: EMAIL_ATTRIBUTES }) })
        ?? nameIdAsEmail({ nameId: extract.nameID })
    if (isNil(email) || !EMAIL_PATTERN.test(email)) {
        return null
    }
    const firstName = firstAttribute({ attributes, names: withMapped({ mapped: attributeMapping?.firstName, defaults: FIRST_NAME_ATTRIBUTES }) })
    const lastName = firstAttribute({ attributes, names: withMapped({ mapped: attributeMapping?.lastName, defaults: LAST_NAME_ATTRIBUTES }) })
    return {
        email: email.trim().toLowerCase(),
        firstName: firstName ?? '',
        lastName: lastName ?? '',
    }
}

function nameIdAsEmail({ nameId }: NameIdAsEmailParams): string | null {
    return typeof nameId === 'string' && EMAIL_PATTERN.test(nameId.trim()) ? nameId.trim() : null
}

function readAssertionDetails({ extract, samlContent, acsUrl }: ReadAssertionDetailsParams): AssertionDetails {
    const fields = samlify.Extractor.extract(samlContent, ASSERTION_DETAIL_FIELDS)
    const assertion = asStringRecord({ value: fields.assertion })
    if (isNil(assertion) || typeof assertion.id !== 'string') {
        throw invalidResponse({ message: 'Response must contain exactly one assertion' })
    }
    const confirmation = asStringRecord({ value: fields.confirmation }) ?? {}
    const inResponseTo = confirmation.inResponseTo
    if (typeof inResponseTo !== 'string' || inResponseTo.length === 0) {
        throw invalidResponse({ message: 'Assertion is not a response to a login request' })
    }
    const responseAttributes = asStringRecord({ value: extract.response }) ?? {}
    assertUnsetOrEqual({ actual: responseAttributes.inResponseTo, expected: inResponseTo, message: 'InResponseTo values disagree' })
    assertUnsetOrEqual({ actual: responseAttributes.destination, expected: acsUrl, message: 'Response destination is not this service' })
    assertUnsetOrEqual({ actual: confirmation.recipient, expected: acsUrl, message: 'Assertion recipient is not this service' })
    const conditions = asStringRecord({ value: extract.conditions }) ?? {}
    const notOnOrAfter = firstString({ values: [confirmation.notOnOrAfter, conditions.notOnOrAfter] })
    return { assertionId: assertion.id, inResponseTo, notOnOrAfter }
}

function replayTtlSeconds({ notOnOrAfter }: ReplayTtlParams): number {
    const expiry = isNil(notOnOrAfter) ? Number.NaN : new Date(notOnOrAfter).getTime()
    if (Number.isNaN(expiry)) {
        return DEFAULT_REPLAY_TTL_SECONDS
    }
    const seconds = Math.ceil((expiry - Date.now()) / 1000) + CLOCK_DRIFT_MS / 1000
    return Math.min(Math.max(seconds, MIN_REPLAY_TTL_SECONDS), MAX_REPLAY_TTL_SECONDS)
}

function assertUnsetOrEqual({ actual, expected, message }: AssertUnsetOrEqualParams): void {
    if (typeof actual === 'string' && actual.length > 0 && actual !== expected) {
        throw invalidResponse({ message })
    }
}

function asStringRecord({ value }: AsStringRecordParams): Record<string, string | string[]> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value
    }
    return null
}

function firstString({ values }: FirstStringParams): string | null {
    return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null
}

function withMapped({ mapped, defaults }: WithMappedParams): string[] {
    return isNil(mapped) || mapped.length === 0 ? defaults : [mapped, ...defaults]
}

function firstAttribute({ attributes, names }: FirstAttributeParams): string | null {
    for (const name of names) {
        const value = attributes[name]
        const candidate = Array.isArray(value) ? value[0] : value
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim()
        }
    }
    return null
}

function invalidResponse({ message }: InvalidResponseParams): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.INVALID_SAML_RESPONSE,
        params: { message },
    })
}

const SP_ENTITY_ID = 'Activepieces'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_REPLAY_TTL_SECONDS = 600
const MIN_REPLAY_TTL_SECONDS = 60
const MAX_REPLAY_TTL_SECONDS = 3600
const ASSERTION_DETAIL_FIELDS: ExtractorFields = [
    {
        key: 'assertion',
        localPath: ['Response', 'Assertion'],
        attributes: ['ID', 'IssueInstant'],
    },
    {
        key: 'confirmation',
        localPath: ['Response', 'Assertion', 'Subject', 'SubjectConfirmation', 'SubjectConfirmationData'],
        attributes: ['InResponseTo', 'Recipient', 'NotOnOrAfter'],
    },
]
const ACS_PATH = 'v1/authn/saml/acs'
const NAME_ID_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'
const CLOCK_DRIFT_MS = 60_000
const EMAIL_ATTRIBUTES = ['email', 'mail', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']
const FIRST_NAME_ATTRIBUTES = ['firstName', 'givenName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname']
const LAST_NAME_ATTRIBUTES = ['lastName', 'familyName', 'sn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']

export const samlConstants = {
    SP_ENTITY_ID,
    ACS_PATH,
}

type ExtractorFields = Parameters<typeof samlify.Extractor.extract>[1]

type AssertionDetails = {
    assertionId: string
    inResponseTo: string
    notOnOrAfter: string | null
}

export type SamlLoginStart =
    | { binding: 'redirect', loginUrl: string, nonce: string }
    | { binding: 'post', actionUrl: string, samlRequest: string, relayState: string, nonce: string }

type NameIdAsEmailParams = {
    nameId: ParsedExtract[string]
}

type ReadAssertionDetailsParams = {
    extract: ParsedExtract
    samlContent: string
    acsUrl: string
}

type ReplayTtlParams = {
    notOnOrAfter: string | null
}

type AssertUnsetOrEqualParams = {
    actual: string | string[] | undefined
    expected: string
    message: string
}

type AsStringRecordParams = {
    value: ParsedExtract[string]
}

type FirstStringParams = {
    values: Array<string | string[] | undefined>
}

type ParsedExtract = Awaited<ReturnType<samlify.ServiceProviderInstance['parseLoginResponse']>>['extract']

type Entities = {
    sp: samlify.ServiceProviderInstance
    idp: samlify.IdentityProviderInstance
    binding: SsoBinding
}

type SamlProfile = {
    email: string
    firstName: string
    lastName: string
}

type BuildLoginUrlParams = {
    platformId: PlatformId
}

type CompleteLoginParams = {
    platformId: PlatformId
    samlResponse: string
}

type ClaimParams = {
    code: string
    nonce: string | null
}

type GetSamlConfigParams = {
    platformId: PlatformId
    log: FastifyBaseLogger
}

type BuildEntitiesParams = {
    config: SAMLAuthnProviderConfig
}

type ReadProfileParams = {
    extract: ParsedExtract
    attributeMapping: SAMLAttributeMapping | undefined
}

type FirstAttributeParams = {
    attributes: Record<string, string | string[]>
    names: string[]
}

type WithMappedParams = {
    mapped: string | undefined
    defaults: string[]
}

type InvalidResponseParams = {
    message: string
}
