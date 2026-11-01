import { randomBytes } from 'node:crypto'
import { ActivepiecesError, ErrorCode, isNil, PlatformId } from '@activepieces/core-utils'
import { SsoDomainVerification, SsoDomainVerificationRecordType, SsoDomainVerificationStatus } from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { platformRepo, platformService } from '../../platform/platform.service'
import { dnsTxtResolver } from './dns-txt-resolver'

export const ssoDomainService = (log: FastifyBaseLogger) => ({
    async set({ platformId, ssoDomain, userId, ip }: SetParams): Promise<SsoDomainState> {
        if (isNil(ssoDomain)) {
            await platformService(log).update({
                id: platformId,
                ssoDomain: null,
                ssoDomainVerification: null,
                userId,
                ip,
            })
            return { ssoDomain: null, ssoDomainVerification: null }
        }
        await assertDomainIsFree({ platformId, ssoDomain })
        const ssoDomainVerification: SsoDomainVerification = {
            status: SsoDomainVerificationStatus.PENDING_VERIFICATION,
            record: {
                type: SsoDomainVerificationRecordType.TXT,
                name: `${RECORD_NAME_PREFIX}.${ssoDomain}`,
                value: `${RECORD_VALUE_PREFIX}${randomBytes(RECORD_VALUE_BYTES).toString('hex')}`,
            },
            createdAt: dayjs().toISOString(),
        }
        await platformService(log).update({ id: platformId, ssoDomain, ssoDomainVerification, userId, ip })
        return { ssoDomain, ssoDomainVerification }
    },

    async verify({ platformId, userId, ip }: VerifyParams): Promise<SsoDomainState> {
        const platform = await platformService(log).getOneOrThrow(platformId)
        const ssoDomain = platform.ssoDomain ?? null
        const verification = platform.ssoDomainVerification ?? null
        if (isNil(ssoDomain) || isNil(verification)) {
            return { ssoDomain: null, ssoDomainVerification: null }
        }
        if (verification.status === SsoDomainVerificationStatus.VERIFIED) {
            return { ssoDomain, ssoDomainVerification: verification }
        }
        const values = await dnsTxtResolver.lookup({ name: verification.record.name })
        if (!values.includes(verification.record.value)) {
            return { ssoDomain, ssoDomainVerification: verification }
        }
        const verified: SsoDomainVerification = { ...verification, status: SsoDomainVerificationStatus.VERIFIED }
        await platformService(log).update({ id: platformId, ssoDomainVerification: verified, userId, ip })
        return { ssoDomain, ssoDomainVerification: verified }
    },

    async discover({ domain }: DiscoverParams): Promise<{ platformId: PlatformId | null }> {
        const platform = await platformRepo().findOneBy({ ssoDomain: domain.toLowerCase() })
        if (isNil(platform) || platform.ssoDomainVerification?.status !== SsoDomainVerificationStatus.VERIFIED) {
            return { platformId: null }
        }
        const samlConfigured = await platformService(log).hasSamlConfigured(platform.id)
        return { platformId: samlConfigured ? platform.id : null }
    },
})

async function assertDomainIsFree({ platformId, ssoDomain }: AssertDomainIsFreeParams): Promise<void> {
    const holder = await platformRepo().findOneBy({ ssoDomain })
    if (!isNil(holder) && holder.id !== platformId) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'This domain is already claimed by another platform' },
        })
    }
}

const RECORD_NAME_PREFIX = '_ap-sso-verification'
const RECORD_VALUE_PREFIX = 'ap-sso-verification='
const RECORD_VALUE_BYTES = 16

export const SSO_DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export type SsoDomainState = {
    ssoDomain: string | null
    ssoDomainVerification: SsoDomainVerification | null
}

type SetParams = {
    platformId: PlatformId
    ssoDomain: string | null
    userId: string
    ip: string
}

type VerifyParams = {
    platformId: PlatformId
    userId: string
    ip: string
}

type DiscoverParams = {
    domain: string
}

type AssertDomainIsFreeParams = {
    platformId: PlatformId
    ssoDomain: string
}
