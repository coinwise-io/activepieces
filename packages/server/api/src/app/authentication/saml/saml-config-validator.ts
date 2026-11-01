import { X509Certificate } from 'node:crypto'
import { ActivepiecesError, ErrorCode, isNil, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import { safeHttp } from '@activepieces/server-utils'
import { SAMLAuthnProviderConfig } from '@activepieces/shared'
import * as samlify from 'samlify'

async function normalize({ config }: NormalizeParams): Promise<SAMLAuthnProviderConfig> {
    const idpMetadata = await resolveMetadata({ rawMetadata: config.idpMetadata })
    assertIdpMetadataIsUsable({ idpMetadata })
    const idpCertificate = normalizeCertificate({ rawCertificate: config.idpCertificate })
    return {
        ...config,
        idpMetadata,
        idpCertificate,
    }
}

function extractIdpDescriptor({ idpMetadata }: ExtractIdpDescriptorParams): IdpDescriptor {
    const { data: metadata, error } = tryCatchSync(() => samlify.IdPMetadata(idpMetadata))
    if (!isNil(error) || isNil(metadata)) {
        throw invalidConfig({ message: 'The identity provider metadata is not a valid SAML IdP descriptor' })
    }
    const entityId = metadata.getEntityID()
    if (typeof entityId !== 'string' || entityId.length === 0) {
        throw invalidConfig({ message: 'The identity provider metadata has no entityID' })
    }
    const redirectService = metadata.getSingleSignOnService('redirect')
    if (typeof redirectService !== 'string' || redirectService.length === 0) {
        throw invalidConfig({ message: 'The identity provider metadata has no HTTP-Redirect single sign-on service' })
    }
    return {
        entityId,
        singleSignOnUrl: redirectService,
        wantsSignedRequests: metadata.isWantAuthnRequestsSigned(),
    }
}

function assertIdpMetadataIsUsable({ idpMetadata }: ExtractIdpDescriptorParams): void {
    const descriptor = extractIdpDescriptor({ idpMetadata })
    if (descriptor.wantsSignedRequests) {
        throw invalidConfig({ message: 'The identity provider requires signed authentication requests, which are not supported' })
    }
}

async function resolveMetadata({ rawMetadata }: ResolveMetadataParams): Promise<string> {
    const trimmed = rawMetadata.trim()
    if (trimmed.startsWith('<')) {
        return trimmed
    }
    if (!isHttpsUrl({ value: trimmed })) {
        throw invalidConfig({ message: 'The identity provider metadata must be XML or an https URL' })
    }
    const { data, error } = await tryCatch(() => safeHttp.axios.get<string>(trimmed, {
        timeout: METADATA_FETCH_TIMEOUT_MS,
        maxContentLength: METADATA_MAX_BYTES,
        maxBodyLength: METADATA_MAX_BYTES,
        maxRedirects: METADATA_MAX_REDIRECTS,
        beforeRedirect: (options) => {
            if (options.protocol !== 'https:') {
                throw invalidConfig({ message: 'The identity provider metadata URL redirected to a non-https location' })
            }
        },
        signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
        responseType: 'text',
        transformResponse: (body: string) => body,
    }))
    if (!isNil(error) || isNil(data)) {
        throw invalidConfig({ message: 'The identity provider metadata URL could not be fetched' })
    }
    const fetched = typeof data.data === 'string' ? data.data.trim() : ''
    if (!fetched.startsWith('<')) {
        throw invalidConfig({ message: 'The identity provider metadata URL did not return XML' })
    }
    return fetched
}

function normalizeCertificate({ rawCertificate }: NormalizeCertificateParams): string {
    const body = rawCertificate
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s+/g, '')
    if (!BASE64_PATTERN.test(body)) {
        throw invalidConfig({ message: 'The identity provider certificate is not a valid X.509 certificate' })
    }
    const pem = `-----BEGIN CERTIFICATE-----\n${(body.match(/.{1,64}/g) ?? []).join('\n')}\n-----END CERTIFICATE-----`
    const { data: certificate, error } = tryCatchSync(() => new X509Certificate(pem))
    if (!isNil(error) || isNil(certificate)) {
        throw invalidConfig({ message: 'The identity provider certificate is not a valid X.509 certificate' })
    }
    if (new Date(certificate.validTo).getTime() < Date.now()) {
        throw invalidConfig({ message: 'The identity provider certificate has expired' })
    }
    return pem
}

function isHttpsUrl({ value }: IsHttpsUrlParams): boolean {
    const { data: url } = tryCatchSync(() => new URL(value))
    return !isNil(url) && url.protocol === 'https:'
}

function invalidConfig({ message }: InvalidConfigParams): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.INVALID_SAML_RESPONSE,
        params: { message },
    })
}

const METADATA_FETCH_TIMEOUT_MS = 10_000
const METADATA_MAX_BYTES = 1024 * 1024
const METADATA_MAX_REDIRECTS = 3
const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/

export const samlConfigValidator = {
    normalize,
    extractIdpDescriptor,
}

export type IdpDescriptor = {
    entityId: string
    singleSignOnUrl: string
    wantsSignedRequests: boolean
}

type NormalizeParams = {
    config: SAMLAuthnProviderConfig
}

type ExtractIdpDescriptorParams = {
    idpMetadata: string
}

type ResolveMetadataParams = {
    rawMetadata: string
}

type NormalizeCertificateParams = {
    rawCertificate: string
}

type IsHttpsUrlParams = {
    value: string
}

type InvalidConfigParams = {
    message: string
}
