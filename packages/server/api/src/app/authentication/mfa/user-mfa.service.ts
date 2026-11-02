import { randomBytes } from 'node:crypto'
import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { transaction } from '../../core/db/transaction'
import { encryptUtils } from '../../helper/encryption'
import { totp } from './totp'
import { UserMfaEntity } from './user-mfa.entity'

const RECOVERY_CODE_COUNT = 10
const RECOVERY_CODE_HALF_LENGTH = 5

export const userMfaRepo = repoFactory(UserMfaEntity)

export const userMfaService = (log: FastifyBaseLogger) => ({
    async isEnabled({ userId }: UserParams): Promise<boolean> {
        return userMfaRepo().existsBy({ userId })
    },
    async status({ userId }: UserParams): Promise<{ enabled: boolean, recoveryCodesRemaining: number }> {
        const row = await userMfaRepo().findOneBy({ userId })
        return {
            enabled: !isNil(row),
            recoveryCodesRemaining: row?.recoveryCodeHashes.length ?? 0,
        }
    },
    async listEnrolledUserIds({ platformId }: { platformId: string }): Promise<string[]> {
        const rows = await userMfaRepo().createQueryBuilder('mfa')
            .innerJoin('user', 'member', 'member.id = mfa."userId"')
            .where('member."platformId" = :platformId', { platformId })
            .select('mfa."userId"', 'userId')
            .getRawMany<{ userId: string }>()
        return rows.map((row) => row.userId)
    },
    async enable({ userId, platformId, secret, confirmedStep }: EnableParams): Promise<string[]> {
        const recoveryCodes = generateRecoveryCodes()
        const recoveryCodeHashes = await Promise.all(recoveryCodes.map((code) => hashRecoveryCode({ code })))
        const encryptedSecret = await encryptUtils.encryptString(secret)
        await transaction(async (entityManager) => {
            const alreadyEnabled = await userMfaRepo(entityManager).existsBy({ userId })
            if (alreadyEnabled) {
                throw new ActivepiecesError({ code: ErrorCode.VALIDATION, params: { message: 'Two-factor authentication is already enabled' } })
            }
            await userMfaRepo(entityManager).insert({
                id: apId(),
                userId,
                platformId,
                secret: encryptedSecret,
                lastUsedStep: confirmedStep,
                recoveryCodeHashes,
            })
        })
        log.info({ user: { id: userId }, platform: { id: platformId } }, 'Two-factor authentication enabled')
        return recoveryCodes
    },
    async verify({ userId, code }: VerifyParams): Promise<boolean> {
        const candidateHash = totp.isTotpFormat(code) ? null : await hashRecoveryCode({ code })
        return transaction(async (entityManager) => {
            const row = await userMfaRepo(entityManager).findOne({ where: { userId }, lock: { mode: 'pessimistic_write' } })
            if (isNil(row)) {
                return false
            }
            if (isNil(candidateHash)) {
                const secret = await encryptUtils.decryptString(row.secret)
                const step = totp.findMatchingStep({ secret, code, nowMs: Date.now(), lastUsedStep: row.lastUsedStep })
                if (isNil(step)) {
                    return false
                }
                await userMfaRepo(entityManager).update({ id: row.id }, { lastUsedStep: step })
                return true
            }
            const remaining = row.recoveryCodeHashes.filter((hash) => !encryptUtils.digestsMatch(hash, candidateHash))
            if (remaining.length === row.recoveryCodeHashes.length) {
                return false
            }
            await userMfaRepo(entityManager).update({ id: row.id }, { recoveryCodeHashes: remaining })
            log.info({ user: { id: userId }, recoveryCodesRemainingCount: remaining.length }, 'Recovery code used')
            return true
        })
    },
    async regenerateRecoveryCodes({ userId }: UserParams): Promise<string[]> {
        const recoveryCodes = generateRecoveryCodes()
        const recoveryCodeHashes = await Promise.all(recoveryCodes.map((code) => hashRecoveryCode({ code })))
        await userMfaRepo().update({ userId }, { recoveryCodeHashes })
        log.info({ user: { id: userId } }, 'Recovery codes regenerated')
        return recoveryCodes
    },
    async remove({ userId }: UserParams): Promise<void> {
        await userMfaRepo().delete({ userId })
        log.info({ user: { id: userId } }, 'Two-factor authentication removed')
    },
})

function generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
        const raw = totp.base32Encode(randomBytes(RECOVERY_CODE_HALF_LENGTH + 2)).toLowerCase().slice(0, RECOVERY_CODE_HALF_LENGTH * 2)
        return `${raw.slice(0, RECOVERY_CODE_HALF_LENGTH)}-${raw.slice(RECOVERY_CODE_HALF_LENGTH)}`
    })
}

async function hashRecoveryCode({ code }: { code: string }): Promise<string> {
    return encryptUtils.hmacString(`mfa-recovery:${code.replace(/[\s-]+/g, '').toLowerCase()}`)
}

type UserParams = {
    userId: string
}

type EnableParams = {
    userId: string
    platformId: string
    secret: string
    confirmedStep: number
}

type VerifyParams = {
    userId: string
    code: string
}
