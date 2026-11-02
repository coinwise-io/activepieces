import { isNil } from '@activepieces/core-utils'
import { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { scimTokenService } from '../scim-token/scim-token.service'
import { scimErrors } from './scim-errors'

const BEARER_PREFIX = 'bearer '

const platformByRequest = new WeakMap<object, string>()

async function authenticate({ request, log }: { request: FastifyRequest, log: FastifyBaseLogger }): Promise<void> {
    const header = request.headers.authorization
    if (isNil(header) || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
        throw scimErrors.unauthorized({ detail: 'Missing bearer token' })
    }
    const token = header.slice(BEARER_PREFIX.length).trim()
    const authenticated = await scimTokenService(log).authenticate({ token })
    if (isNil(authenticated)) {
        throw scimErrors.unauthorized({ detail: 'Invalid or revoked token' })
    }
    platformByRequest.set(request, authenticated.platformId)
}

function platformIdOf({ request }: { request: FastifyRequest }): string {
    const platformId = platformByRequest.get(request)
    if (isNil(platformId)) {
        throw scimErrors.unauthorized({ detail: 'Missing bearer token' })
    }
    return platformId
}

export const scimAuth = {
    authenticate,
    platformIdOf,
}
