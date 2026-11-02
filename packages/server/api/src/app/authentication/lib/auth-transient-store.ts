import { isNil, tryCatchSync } from '@activepieces/core-utils'
import { z } from 'zod'
import { redisConnections } from '../../database/redis-connections'

async function put({ key, value, ttlSeconds }: PutParams): Promise<void> {
    const redis = await redisConnections.useExisting()
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
}

async function get<T>({ key, schema }: ReadParams<T>): Promise<T | null> {
    const redis = await redisConnections.useExisting()
    return parse({ raw: await redis.get(key), schema })
}

async function take<T>({ key, schema }: ReadParams<T>): Promise<T | null> {
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
    return parse({ raw, schema })
}

async function remove({ key }: { key: string }): Promise<void> {
    const redis = await redisConnections.useExisting()
    await redis.del(key)
}

async function putIfAbsent({ key, ttlSeconds }: PutIfAbsentParams): Promise<boolean> {
    const redis = await redisConnections.useExisting()
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX')
    return result === 'OK'
}

async function increment({ key, ttlSeconds }: IncrementParams): Promise<number> {
    const redis = await redisConnections.useExisting()
    const results = await redis.multi().set(key, '0', 'EX', ttlSeconds, 'NX').incr(key).exec()
    const incrResult = results?.[1]
    if (isNil(incrResult)) {
        throw new Error('Redis transaction was discarded')
    }
    const [incrError, count] = incrResult
    if (!isNil(incrError)) {
        throw incrError
    }
    return Number(count)
}

async function decrement({ key }: { key: string }): Promise<void> {
    const redis = await redisConnections.useExisting()
    await redis.decr(key)
}

async function replaceIfPresent({ key, value, ttlSeconds }: PutParams): Promise<boolean> {
    const redis = await redisConnections.useExisting()
    const result = await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'XX')
    return result === 'OK'
}

function parse<T>({ raw, schema }: { raw: unknown, schema: z.ZodType<T> }): T | null {
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

export const authTransientStore = {
    put,
    get,
    take,
    remove,
    putIfAbsent,
    replaceIfPresent,
    increment,
    decrement,
}

type PutParams = {
    key: string
    value: unknown
    ttlSeconds: number
}

type ReadParams<T> = {
    key: string
    schema: z.ZodType<T>
}

type PutIfAbsentParams = {
    key: string
    ttlSeconds: number
}

type IncrementParams = {
    key: string
    ttlSeconds: number
}
