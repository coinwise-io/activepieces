import { ApId } from '@activepieces/core-utils'
import {
    AccessGrantWithPrincipal,
    CreateAccessGrantRequest,
    EffectiveAccess,
    GetEffectiveAccessRequest,
    ListAccessGrantsRequest,
    ListAccessGrantsResponse,
    ListAccessPrincipalsRequest,
    ListAccessPrincipalsResponse,
    PrincipalType,
    SERVICE_KEY_SECURITY_OPENAPI,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { AccessGrantEntity } from './access-grant.entity'
import { accessGrantService } from './access-grant.service'
import { accessGuard } from './access-guard'

export const accessGrantController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListRequest, async (request) => {
        const access = await accessGuard(request.log).forRequest({ request })
        const data = await accessGrantService(request.log).list({
            projectId: request.projectId,
            access,
            request: request.query,
        })
        return { data }
    })

    app.post('/', CreateRequest, async (request, reply) => {
        const access = await accessGuard(request.log).forRequest({ request })
        const grant = await accessGrantService(request.log).create({
            projectId: request.projectId,
            access,
            request: request.body,
            createdBy: request.principal.type === PrincipalType.USER ? request.principal.id : null,
        })
        return reply.status(StatusCodes.CREATED).send(grant)
    })

    app.delete('/:id', DeleteRequest, async (request, reply) => {
        const access = await accessGuard(request.log).forRequest({ request })
        await accessGrantService(request.log).delete({
            id: request.params.id,
            projectId: request.projectId,
            access,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/effective', EffectiveRequest, async (request) => {
        const access = await accessGuard(request.log).forRequest({ request })
        return accessGrantService(request.log).effective({
            projectId: request.projectId,
            folderId: request.query.folderId,
            flowId: request.query.flowId,
            access,
        })
    })

    app.get('/principals', PrincipalsRequest, async (request) => {
        const access = await accessGuard(request.log).forRequest({ request })
        const data = await accessGrantService(request.log).listPrincipals({
            projectId: request.projectId,
            access,
            search: request.query.search,
        })
        return { data }
    })
}

const ListRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['access-grants'],
        description: 'List the access grants that apply to a project, folder or flow',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListAccessGrantsRequest,
        response: {
            [StatusCodes.OK]: ListAccessGrantsResponse,
        },
    },
}

const CreateRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['access-grants'],
        description: 'Give a user or group a role on a project, folder or flow',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: CreateAccessGrantRequest,
        response: {
            [StatusCodes.CREATED]: AccessGrantWithPrincipal,
        },
    },
}

const DeleteRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: AccessGrantEntity,
        }),
    },
    schema: {
        tags: ['access-grants'],
        description: 'Remove an access grant',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}

const EffectiveRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['access-grants'],
        description: 'Get the roles and permissions the caller holds in a project or on a flow',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: GetEffectiveAccessRequest,
        response: {
            [StatusCodes.OK]: EffectiveAccess,
        },
    },
}

const PrincipalsRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['access-grants'],
        description: 'Search the users and groups of the project platform that can be given access',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListAccessPrincipalsRequest,
        response: {
            [StatusCodes.OK]: ListAccessPrincipalsResponse,
        },
    },
}
