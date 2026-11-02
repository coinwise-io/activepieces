import { randomBytes } from 'node:crypto'
import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { cryptoUtils } from '@activepieces/server-utils'
import { z } from 'zod'
import { EncryptedObject } from '../../helper/encryption'
import { authTransientStore } from '../lib/auth-transient-store'

const CHALLENGE_TTL_SECONDS = 300
const MAX_ATTEMPTS = 5
const TOKEN_BYTES = 32

async function create({ userId, platformId, projectId, enrollmentRequired }: CreateParams): Promise<string> {
    const challengeToken = randomBytes(TOKEN_BYTES).toString('base64url')
    const state: MfaChallengeState = {
        userId,
        platformId,
        projectId,
        enrollmentRequired,
        pendingSecret: null,
        expiresAtMs: Date.now() + CHALLENGE_TTL_SECONDS * 1000,
    }
    await authTransientStore.put({ key: challengeKey({ challengeToken }), value: state, ttlSeconds: CHALLENGE_TTL_SECONDS })
    return challengeToken
}

async function load({ challengeToken }: TokenParams): Promise<MfaChallengeState> {
    const state = await authTransientStore.get({ key: challengeKey({ challengeToken }), schema: MfaChallengeState })
    if (isNil(state)) {
        throw challengeExpired()
    }
    return state
}

async function savePendingSecret({ challengeToken, state, pendingSecret }: SavePendingSecretParams): Promise<void> {
    const remainingSeconds = Math.floor((state.expiresAtMs - Date.now()) / 1000)
    if (remainingSeconds <= 0) {
        throw challengeExpired()
    }
    const replaced = await authTransientStore.replaceIfPresent({
        key: challengeKey({ challengeToken }),
        value: { ...state, pendingSecret },
        ttlSeconds: remainingSeconds,
    })
    if (!replaced) {
        throw challengeExpired()
    }
}

async function consume({ challengeToken }: TokenParams): Promise<MfaChallengeState> {
    const state = await authTransientStore.take({ key: challengeKey({ challengeToken }), schema: MfaChallengeState })
    if (isNil(state)) {
        throw challengeExpired()
    }
    return state
}

async function registerAttempt({ challengeToken }: TokenParams): Promise<void> {
    const attempts = await authTransientStore.increment({ key: attemptsKey({ challengeToken }), ttlSeconds: CHALLENGE_TTL_SECONDS })
    if (attempts > MAX_ATTEMPTS) {
        await authTransientStore.remove({ key: challengeKey({ challengeToken }) })
        throw challengeExpired()
    }
}

function challengeKey({ challengeToken }: TokenParams): string {
    return `mfa_challenge:${cryptoUtils.hashSHA256(challengeToken)}`
}

function attemptsKey({ challengeToken }: TokenParams): string {
    return `mfa_challenge_attempts:${cryptoUtils.hashSHA256(challengeToken)}`
}

function challengeExpired(): ActivepiecesError {
    return new ActivepiecesError({ code: ErrorCode.MFA_CHALLENGE_EXPIRED, params: {} })
}

export const mfaChallengeStore = {
    create,
    load,
    savePendingSecret,
    consume,
    registerAttempt,
}

export const MfaChallengeState = z.object({
    userId: z.string(),
    platformId: z.string(),
    projectId: z.string().nullable(),
    enrollmentRequired: z.boolean(),
    pendingSecret: EncryptedObject.nullable(),
    expiresAtMs: z.number(),
})
export type MfaChallengeState = z.infer<typeof MfaChallengeState>

type CreateParams = {
    userId: string
    platformId: string
    projectId: string | null
    enrollmentRequired: boolean
}

type TokenParams = {
    challengeToken: string
}

type SavePendingSecretParams = TokenParams & {
    state: MfaChallengeState
    pendingSecret: EncryptedObject
}
