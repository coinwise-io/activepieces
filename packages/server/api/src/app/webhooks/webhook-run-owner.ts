import { distributedStore } from '../database/redis-connections'

const KEY_PREFIX = 'webhook-run-owner:v1:'
const TTL_SECONDS = 600

export const webhookRunOwner = {
    async remember({ requestId, userId }: { requestId: string, userId: string }): Promise<void> {
        await distributedStore.put(`${KEY_PREFIX}${requestId}`, userId, TTL_SECONDS)
    },
    async recall({ requestId }: { requestId: string | undefined }): Promise<string | undefined> {
        if (requestId === undefined) {
            return undefined
        }
        return (await distributedStore.get<string>(`${KEY_PREFIX}${requestId}`)) ?? undefined
    },
}
