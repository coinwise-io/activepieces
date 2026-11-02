import { isNil } from '@activepieces/core-utils'
import { ScimResourceId } from '@activepieces/shared'
import { FastifyBodyParser, FastifyInstance, FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { domainHelper } from '../../helper/domain-helper'
import { scimAuth } from './scim-auth'
import { scimDiscovery } from './scim-discovery'
import { scimErrors } from './scim-errors'
import { ScimCreateGroupBody, scimGroupService, ScimReplaceGroupBody } from './scim-group.service'
import { ScimCreateUserBody, ScimReplaceUserBody, scimUserService } from './scim-user.service'

const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8'
const MAX_START_INDEX = 1_000_000
const MAX_COUNT = 200
const SCIM_BASE_PATH = 'v1/scim/v2'

export const scimController: FastifyPluginAsyncZod = async (app) => {
    registerScimContentTypeParser({ app })

    app.addHook('onRequest', async (request, reply) => {
        void reply.type(SCIM_CONTENT_TYPE)
        await scimAuth.authenticate({ request, log: request.log })
    })

    app.setErrorHandler(async (error, request, reply) => {
        const scimError = toScimError({ error })
        if (scimError.status >= StatusCodes.INTERNAL_SERVER_ERROR) {
            request.log.error({ error }, 'SCIM request failed')
        }
        return reply.status(scimError.status).type(SCIM_CONTENT_TYPE).send(scimErrors.toBody({ error: scimError }))
    })

    app.get('/ServiceProviderConfig', ScimRoute, async () => {
        return scimDiscovery.serviceProviderConfig({ baseUrl: await baseUrlOf() })
    })

    app.get('/ResourceTypes', ScimRoute, async () => {
        return scimDiscovery.resourceTypes({ baseUrl: await baseUrlOf() })
    })

    app.get('/Schemas', ScimRoute, async () => {
        return scimDiscovery.schemas({ baseUrl: await baseUrlOf() })
    })

    app.get('/Users', ListRoute, async (request) => {
        return scimUserService(request.log).list({
            platformId: platformIdOf({ request }),
            filter: request.query.filter,
            startIndex: request.query.startIndex,
            count: request.query.count,
            baseUrl: await baseUrlOf(),
        })
    })

    app.post('/Users', CreateUserRoute, async (request, reply) => {
        const created = await scimUserService(request.log).create({
            platformId: platformIdOf({ request }),
            request: request.body,
            baseUrl: await baseUrlOf(),
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.get('/Users/:id', IdRoute, async (request) => {
        return scimUserService(request.log).get({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            baseUrl: await baseUrlOf(),
        })
    })

    app.put('/Users/:id', ReplaceUserRoute, async (request) => {
        return scimUserService(request.log).replace({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            request: request.body,
            baseUrl: await baseUrlOf(),
        })
    })

    app.patch('/Users/:id', PatchRoute, async (request) => {
        return scimUserService(request.log).patch({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            operations: request.body.Operations,
            baseUrl: await baseUrlOf(),
        })
    })

    app.delete('/Users/:id', IdRoute, async (request, reply) => {
        await scimUserService(request.log).deactivate({
            platformId: platformIdOf({ request }),
            id: request.params.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/Groups', ListRoute, async (request) => {
        return scimGroupService.list({
            platformId: platformIdOf({ request }),
            filter: request.query.filter,
            startIndex: request.query.startIndex,
            count: request.query.count,
            baseUrl: await baseUrlOf(),
        })
    })

    app.post('/Groups', CreateGroupRoute, async (request, reply) => {
        const created = await scimGroupService.create({
            platformId: platformIdOf({ request }),
            request: request.body,
            baseUrl: await baseUrlOf(),
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.get('/Groups/:id', IdRoute, async (request) => {
        return scimGroupService.get({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            baseUrl: await baseUrlOf(),
        })
    })

    app.put('/Groups/:id', ReplaceGroupRoute, async (request) => {
        return scimGroupService.replace({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            request: request.body,
            baseUrl: await baseUrlOf(),
        })
    })

    app.patch('/Groups/:id', PatchRoute, async (request) => {
        return scimGroupService.patch({
            platformId: platformIdOf({ request }),
            id: request.params.id,
            operations: request.body.Operations,
            baseUrl: await baseUrlOf(),
        })
    })

    app.delete('/Groups/:id', IdRoute, async (request, reply) => {
        await scimGroupService.delete({
            platformId: platformIdOf({ request }),
            id: request.params.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

function registerScimContentTypeParser({ app }: { app: FastifyInstance }): void {
    const parseJson = app.getDefaultJsonParser('error', 'error')
    const parseJsonAllowingEmptyBody: FastifyBodyParser<string> = (request, body, done) => {
        if (body.trim() === '') {
            done(null, undefined)
            return
        }
        return parseJson(request, body, done)
    }
    app.removeContentTypeParser('application/json')
    app.addContentTypeParser(['application/json', 'application/scim+json'], { parseAs: 'string' }, parseJsonAllowingEmptyBody)
}

function platformIdOf({ request }: { request: FastifyRequest }): string {
    return scimAuth.platformIdOf({ request })
}

async function baseUrlOf(): Promise<string> {
    const url = await domainHelper.getPublicApiUrl({ path: SCIM_BASE_PATH })
    return `${url.replace(/\/+$/, '')}/`
}

function toScimError({ error }: { error: unknown }) {
    if (typeof error === 'object' && error !== null && 'validation' in error && error.validation) {
        return scimErrors.badRequest({ detail: error instanceof Error ? error.message : 'Invalid request', scimType: 'invalidValue' })
    }
    const statusCode = readStatusCode({ error })
    if (error instanceof Error && !isNil(statusCode) && statusCode >= StatusCodes.BAD_REQUEST && statusCode < StatusCodes.INTERNAL_SERVER_ERROR) {
        return scimErrors.badRequest({ detail: error.message, scimType: 'invalidSyntax' })
    }
    return scimErrors.fromUnknown({ error })
}

function readStatusCode({ error }: { error: unknown }): number | undefined {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') {
        return error.statusCode
    }
    return undefined
}

const ScimListQuery = z.object({
    filter: z.string().optional(),
    startIndex: z.coerce.number().int().min(1).max(MAX_START_INDEX).optional(),
    count: z.coerce.number().int().min(0).max(MAX_COUNT).optional(),
})

const ScimRoute = {
    config: {
        security: securityAccess.public(),
    },
}

const ListRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        querystring: ScimListQuery,
    },
}

const IdRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: ScimResourceId,
    },
}

const CreateUserRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        body: ScimCreateUserBody,
    },
}

const ReplaceUserRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: ScimResourceId,
        body: ScimReplaceUserBody,
    },
}

const CreateGroupRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        body: ScimCreateGroupBody,
    },
}

const ReplaceGroupRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: ScimResourceId,
        body: ScimReplaceGroupBody,
    },
}

const PatchRoute = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: ScimResourceId,
        body: z.object({
            schemas: z.array(z.string()).optional(),
            Operations: z.array(z.object({
                op: z.string(),
                path: z.string().optional(),
                value: z.unknown().optional(),
            })),
        }),
    },
}
