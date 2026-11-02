import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { accessGrantController } from './access-grant.controller'

export const accessControlModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(accessGrantController, { prefix: '/v1/access-grants' })
}
