import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { projectWorkerController } from './project-worker-controller'
import { platformListController, projectController } from './project.controller'

export const projectModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(projectController, { prefix: '/v1/projects' })
    await app.register(platformListController, { prefix: '/v1/platforms' })
    await app.register(projectWorkerController, { prefix: '/v1/worker/project' })
}
