import { randomBytes } from 'node:crypto'
import { isNil, tryCatch } from '@activepieces/core-utils'
import { AuthenticationResponse, ClaimSamlLoginRequest, PrincipalType } from '@activepieces/shared'
import { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { authnRateLimit } from '../../core/security/rate-limit'
import { domainHelper } from '../../helper/domain-helper'
import { networkUtils } from '../../helper/network-utils'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { platformUtils } from '../../platform/platform.utils'
import { samlService } from './saml.service'
import { SSO_DOMAIN_PATTERN, ssoDomainService } from './sso-domain.service'

export const samlController: FastifyPluginAsyncZod = async (app) => {
    app.get('/login', LoginRequestOptions, async (request, reply) => {
        const platformId = request.query.platformId ?? await platformUtils.getPlatformIdForRequest(request)
        if (isNil(platformId)) {
            return redirectToSignIn({ reply, log: request.log, reason: 'No platform resolved for SAML login' })
        }
        const { data: login, error } = await tryCatch(() => samlService(request.log).startLogin({ platformId }))
        if (!isNil(error) || isNil(login)) {
            return redirectToSignIn({ reply, log: request.log, reason: 'Failed to build SAML login request', error })
        }
        void reply.header('Set-Cookie', nonceCookie({ nonce: login.nonce, maxAgeSeconds: NONCE_COOKIE_MAX_AGE_SECONDS }))
        if (login.binding === 'redirect') {
            return reply.redirect(login.loginUrl, 302)
        }
        const scriptNonce = randomBytes(16).toString('base64')
        return reply
            .type('text/html')
            .header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${scriptNonce}'; base-uri 'none'; frame-ancestors 'none'`)
            .header('Cache-Control', 'no-store')
            .header('X-Content-Type-Options', 'nosniff')
            .send(autoPostPage({ actionUrl: login.actionUrl, samlRequest: login.samlRequest, relayState: login.relayState, scriptNonce }))
    })

    app.post('/acs', AcsRequestOptions, async (request, reply) => {
        const { SAMLResponse, RelayState } = request.body
        if (isNil(RelayState) || RelayState.length === 0) {
            return redirectToSignIn({ reply, log: request.log, reason: 'SAML response without relay state' })
        }
        const { data: code, error } = await tryCatch(() => samlService(request.log).completeLogin({
            platformId: RelayState,
            samlResponse: SAMLResponse,
        }))
        if (!isNil(error) || isNil(code)) {
            return redirectToSignIn({ reply, log: request.log, reason: 'SAML response rejected', error })
        }
        const frontendUrl = domainHelper.getConfiguredPublicUrl()
        return reply.redirect(`${frontendUrl}/authenticate?code=${encodeURIComponent(code)}`, 302)
    })

    app.post('/claim', ClaimRequestOptions, async (request, reply): Promise<AuthenticationResponse> => {
        const response = await samlService(request.log).claim({
            code: request.body.code,
            nonce: readNonceCookie({ cookieHeader: request.headers.cookie }),
        })
        void reply.header('Set-Cookie', nonceCookie({ nonce: '', maxAgeSeconds: 0 }))
        return response
    })

    app.post('/discover', DiscoverRequestOptions, async (request) => {
        return ssoDomainService(request.log).discover({ domain: request.body.domain })
    })

    app.post('/sso-domain', SsoDomainRequestOptions, async (request) => {
        return ssoDomainService(request.log).set({
            platformId: request.principal.platform.id,
            ssoDomain: request.body.ssoDomain,
            userId: request.principal.id,
            ip: clientIp(request),
        })
    })

    app.post('/sso-domain/verify', VerifySsoDomainRequestOptions, async (request) => {
        return ssoDomainService(request.log).verify({
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            ip: clientIp(request),
        })
    })
}

function autoPostPage({ actionUrl, samlRequest, relayState, scriptNonce }: AutoPostPageParams): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in</title></head>
<body>
<form method="post" action="${escapeHtml({ value: actionUrl })}">
<input type="hidden" name="SAMLRequest" value="${escapeHtml({ value: samlRequest })}">
<input type="hidden" name="RelayState" value="${escapeHtml({ value: relayState })}">
<noscript><button type="submit">Continue</button></noscript>
</form>
<script nonce="${scriptNonce}">document.forms[0].submit()</script>
</body></html>`
}

function escapeHtml({ value }: { value: string }): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function redirectToSignIn({ reply, log, reason, error }: RedirectToSignInParams) {
    log.warn({ error, reason }, '[samlController] SAML sign-in failed')
    return reply.redirect(`${domainHelper.getConfiguredPublicUrl()}/sign-in`, 302)
}

function nonceCookie({ nonce, maxAgeSeconds }: NonceCookieParams): string {
    const secure = domainHelper.getConfiguredPublicUrl().startsWith('https:') ? '; Secure' : ''
    return `${NONCE_COOKIE_NAME}=${nonce}; Max-Age=${maxAgeSeconds}; Path=${NONCE_COOKIE_PATH}; HttpOnly; SameSite=Lax${secure}`
}

function readNonceCookie({ cookieHeader }: ReadNonceCookieParams): string | null {
    const pair = (cookieHeader ?? '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${NONCE_COOKIE_NAME}=`))
    const value = pair?.slice(NONCE_COOKIE_NAME.length + 1)
    return isNil(value) || value.length === 0 ? null : value
}

function clientIp(request: FastifyRequest): string {
    return networkUtils.extractClientRealIp(request, system.get(AppSystemProp.CLIENT_REAL_IP_HEADER))
}

const NONCE_COOKIE_NAME = 'ap_saml_nonce'
const NONCE_COOKIE_PATH = '/api/v1/authn/saml'
const NONCE_COOKIE_MAX_AGE_SECONDS = 600

const LoginQuery = z.object({
    platformId: z.string().min(1).optional(),
})

const AcsBody = z.object({
    SAMLResponse: z.string().min(1),
    RelayState: z.string().optional(),
})

const DiscoverBody = z.object({
    domain: z.string().trim().min(1).max(253),
})

const SsoDomainBody = z.object({
    ssoDomain: z.string().trim().toLowerCase().regex(SSO_DOMAIN_PATTERN, 'invalidDomain').nullable(),
})

const LoginRequestOptions = {
    config: {
        security: securityAccess.public(),
        rateLimit: authnRateLimit,
    },
    schema: {
        querystring: LoginQuery,
    },
}

const AcsRequestOptions = {
    config: {
        security: securityAccess.public(),
        rateLimit: authnRateLimit,
    },
    schema: {
        body: AcsBody,
    },
}

const ClaimRequestOptions = {
    config: {
        security: securityAccess.public(),
        rateLimit: authnRateLimit,
    },
    schema: {
        body: ClaimSamlLoginRequest,
    },
}

const DiscoverRequestOptions = {
    config: {
        security: securityAccess.public(),
        rateLimit: authnRateLimit,
    },
    schema: {
        body: DiscoverBody,
    },
}

const SsoDomainRequestOptions = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: SsoDomainBody,
    },
}

const VerifySsoDomainRequestOptions = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
}

type AutoPostPageParams = {
    actionUrl: string
    samlRequest: string
    relayState: string
    scriptNonce: string
}

type RedirectToSignInParams = {
    reply: FastifyReply
    log: FastifyBaseLogger
    reason: string
    error?: unknown
}

type NonceCookieParams = {
    nonce: string
    maxAgeSeconds: number
}

type ReadNonceCookieParams = {
    cookieHeader: string | undefined
}
