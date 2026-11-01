import { ApId } from '@activepieces/core-utils'
import { CreateScimTokenRequest, CreateScimTokenResponse, ListScimTokensResponse, PrincipalType } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { scimTokenService } from './scim-token.service'

export const scimTokenController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListRequest, async (req) => {
        const data = await scimTokenService(req.log).list({ platformId: req.principal.platform.id })
        return { data }
    })

    app.post('/', CreateRequest, async (req, reply) => {
        const created = await scimTokenService(req.log).create({
            platformId: req.principal.platform.id,
            displayName: req.body.displayName,
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.delete('/:id', DeleteRequest, async (req, reply) => {
        await scimTokenService(req.log).delete({ platformId: req.principal.platform.id, id: req.params.id })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['scim-tokens'],
        description: 'List SCIM tokens of the platform',
        response: {
            [StatusCodes.OK]: ListScimTokensResponse,
        },
    },
}

const CreateRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['scim-tokens'],
        description: 'Create a SCIM token. The token is returned only once',
        body: CreateScimTokenRequest,
        response: {
            [StatusCodes.CREATED]: CreateScimTokenResponse,
        },
    },
}

const DeleteRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['scim-tokens'],
        description: 'Revoke a SCIM token',
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
