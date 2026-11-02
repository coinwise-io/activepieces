import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { verifiedDomainHooks } from '../verified-domain-hooks'
import { samlController } from './saml.controller'
import { ssoDomainService } from './sso-domain.service'

export const samlModule: FastifyPluginAsyncZod = async (app) => {
    verifiedDomainHooks.set((log) => ({
        async findPlatformIdByDomain({ domain }) {
            const { platformId } = await ssoDomainService(log).discover({ domain })
            return platformId
        },
    }))
    await app.register(samlController, {
        prefix: '/v1/authn/saml',
    })
}
