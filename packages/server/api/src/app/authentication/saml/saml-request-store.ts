import { randomBytes } from 'node:crypto'
import { PlatformId } from '@activepieces/core-utils'
import { z } from 'zod'
import { samlTransientStore } from './saml-transient-store'

async function record({ requestId, platformId }: RecordParams): Promise<string> {
    const nonce = randomBytes(NONCE_BYTES).toString('base64url')
    await samlTransientStore.put({
        key: requestKey({ requestId }),
        value: { platformId, nonce },
        ttlSeconds: REQUEST_TTL_SECONDS,
    })
    return nonce
}

async function consume({ requestId }: ConsumeParams): Promise<PendingRequest | null> {
    return samlTransientStore.take({ key: requestKey({ requestId }), schema: PendingRequestSchema })
}

async function markAssertionSeen({ assertionId, ttlSeconds }: MarkAssertionSeenParams): Promise<boolean> {
    return samlTransientStore.putIfAbsent({ key: `saml_assertion:${assertionId}`, ttlSeconds })
}

function requestKey({ requestId }: ConsumeParams): string {
    return `saml_request:${requestId}`
}

const NONCE_BYTES = 32
const REQUEST_TTL_SECONDS = 600

const PendingRequestSchema = z.object({
    platformId: z.string(),
    nonce: z.string(),
})

export const samlRequestStore = {
    record,
    consume,
    markAssertionSeen,
    REQUEST_TTL_SECONDS,
}

type PendingRequest = z.infer<typeof PendingRequestSchema>

type RecordParams = {
    requestId: string
    platformId: PlatformId
}

type ConsumeParams = {
    requestId: string
}

type MarkAssertionSeenParams = {
    assertionId: string
    ttlSeconds: number
}
