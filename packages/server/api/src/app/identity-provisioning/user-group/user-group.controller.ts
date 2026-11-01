import { ListUserGroupsResponse, PrincipalType } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { userGroupService } from './user-group.service'

export const userGroupController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListRequest, async (req) => {
        const data = await userGroupService.list({ platformId: req.principal.platform.id })
        return { data }
    })
}

const ListRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['user-groups'],
        description: 'List the user groups provisioned by SCIM',
        response: {
            [StatusCodes.OK]: ListUserGroupsResponse,
        },
    },
}
