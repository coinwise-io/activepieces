import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { scimController } from './scim/scim.controller'
import { scimTokenController } from './scim-token/scim-token.controller'
import { userGroupController } from './user-group/user-group.controller'

export const identityProvisioningModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(scimTokenController, { prefix: '/v1/scim-tokens' })
    await app.register(userGroupController, { prefix: '/v1/user-groups' })
    await app.register(scimController, { prefix: '/v1/scim/v2' })
}
