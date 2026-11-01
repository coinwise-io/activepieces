import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { usersController } from '../users-controller'
import { platformUserController } from './platform-user-controller'

export const platformUserModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(platformUserController, { prefix: '/v1/users' })
    await app.register(usersController, { prefix: '/v1/users' })
}
