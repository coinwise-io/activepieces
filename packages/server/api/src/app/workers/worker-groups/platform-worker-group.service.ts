import { FastifyBaseLogger } from 'fastify'

export const platformWorkerGroupService = (_log: FastifyBaseLogger) => ({
    async isWorkerGroupsEnabled(_params: { platformId: string }): Promise<boolean> {
        return false
    },

    async getWorkerGroupId(_params: { platformId: string }): Promise<string | null> {
        return null
    },

    async getWorkerGroupPlatformId(_params: { workerGroupId: string }): Promise<string | null> {
        return null
    },

    async isCanaryPlatform(_params: { platformId: string }): Promise<boolean> {
        return false
    },
})
