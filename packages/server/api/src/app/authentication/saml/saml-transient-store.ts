import { isNil, tryCatchSync } from '@activepieces/core-utils'
import { z } from 'zod'
import { redisConnections } from '../../database/redis-connections'

async function put({ key, value, ttlSeconds }: PutParams): Promise<void> {
    const redis = await redisConnections.useExisting()
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
}

async function take<T>({ key, schema }: TakeParams<T>): Promise<T | null> {
    const redis = await redisConnections.useExisting()
    const results = await redis.multi().get(key).del(key).exec()
    const getResult = results?.[0]
    if (isNil(getResult)) {
        throw new Error('Redis transaction was discarded')
    }
    const [getError, raw] = getResult
    if (!isNil(getError)) {
        throw getError
    }
    if (typeof raw !== 'string') {
        return null
    }
    const { data: json, error } = tryCatchSync(() => JSON.parse(raw))
    if (!isNil(error)) {
        return null
    }
    const parsed = schema.safeParse(json)
    return parsed.success ? parsed.data : null
}

async function putIfAbsent({ key, ttlSeconds }: PutIfAbsentParams): Promise<boolean> {
    const redis = await redisConnections.useExisting()
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX')
    return result === 'OK'
}

export const samlTransientStore = {
    put,
    take,
    putIfAbsent,
}

type PutParams = {
    key: string
    value: unknown
    ttlSeconds: number
}

type TakeParams<T> = {
    key: string
    schema: z.ZodType<T>
}

type PutIfAbsentParams = {
    key: string
    ttlSeconds: number
}
