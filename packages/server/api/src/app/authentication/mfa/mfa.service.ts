import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { AuthenticationResponse, ConfirmMfaEnrollmentResponse, MfaEnrollmentSecret, MfaStatus, SignInResponse, UserIdentityProvider } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { EncryptedObject, encryptUtils } from '../../helper/encryption'
import { platformService } from '../../platform/platform.service'
import { userRepo, userService } from '../../user/user-service'
import { authenticationUtils } from '../authentication-utils'
import { authTransientStore } from '../lib/auth-transient-store'
import { ssoPolicy } from '../sso-policy'
import { userIdentityService } from '../user-identity/user-identity-service'
import { mfaChallengeStore } from './mfa-challenge-store'
import { totp } from './totp'
import { userMfaService } from './user-mfa.service'

const SECOND_FACTOR_EXEMPT_PROVIDERS = new Set([UserIdentityProvider.SAML, UserIdentityProvider.JWT])
const SETUP_TTL_SECONDS = 600
const USER_FAILURE_WINDOW_SECONDS = 900
const MAX_USER_FAILURES = 10

export const mfaService = (log: FastifyBaseLogger) => ({
    async issueSession({ userId, platformId, projectId, provider }: IssueSessionParams): Promise<SignInResponse> {
        const requirement = SECOND_FACTOR_EXEMPT_PROVIDERS.has(provider)
            ? MfaRequirement.NONE
            : await requirementFor({ userId, platformId, log })
        if (requirement === MfaRequirement.NONE) {
            return authenticationUtils(log).getProjectAndToken({ userId, platformId, projectId })
        }
        await authenticationUtils(log).assertUserMaySignIn({ userId })
        const challengeToken = await mfaChallengeStore.create({
            userId,
            platformId,
            projectId,
            enrollmentRequired: requirement === MfaRequirement.ENROLL,
        })
        return { mfaRequired: true, challengeToken, enrollmentRequired: requirement === MfaRequirement.ENROLL }
    },

    async assertNotRequired({ userId, platformId }: UserPlatformParams): Promise<void> {
        const requirement = await requirementFor({ userId, platformId, log })
        if (requirement !== MfaRequirement.NONE) {
            throw new ActivepiecesError({ code: ErrorCode.MFA_REQUIRED, params: {} })
        }
    },

    async verifyChallenge({ challengeToken, code }: ChallengeCodeParams): Promise<AuthenticationResponse> {
        const state = await mfaChallengeStore.load({ challengeToken })
        if (state.enrollmentRequired) {
            throw wrongChallengeStep()
        }
        await mfaChallengeStore.registerAttempt({ challengeToken })
        const verified = await verifyForUser({ userId: state.userId, code, log })
        if (!verified) {
            throw invalidCode()
        }
        const consumed = await mfaChallengeStore.consume({ challengeToken })
        return authenticationUtils(log).getProjectAndToken({ userId: consumed.userId, platformId: consumed.platformId, projectId: consumed.projectId })
    },

    async startEnrollment({ challengeToken }: { challengeToken: string }): Promise<MfaEnrollmentSecret> {
        const state = await mfaChallengeStore.load({ challengeToken })
        if (!state.enrollmentRequired) {
            throw wrongChallengeStep()
        }
        const secret = totp.generateSecret()
        await mfaChallengeStore.savePendingSecret({ challengeToken, state, pendingSecret: await encryptUtils.encryptString(secret) })
        return { secret, otpauthUri: await otpauthUriFor({ userId: state.userId, platformId: state.platformId, secret, log }) }
    },

    async confirmEnrollment({ challengeToken, code }: ChallengeCodeParams): Promise<ConfirmMfaEnrollmentResponse> {
        const state = await mfaChallengeStore.load({ challengeToken })
        if (!state.enrollmentRequired || isNil(state.pendingSecret)) {
            throw wrongChallengeStep()
        }
        await mfaChallengeStore.registerAttempt({ challengeToken })
        const secret = await encryptUtils.decryptString(state.pendingSecret)
        const step = totp.findMatchingStep({ secret, code, nowMs: Date.now(), lastUsedStep: null })
        if (isNil(step)) {
            throw invalidCode()
        }
        const consumed = await mfaChallengeStore.consume({ challengeToken })
        const recoveryCodes = await userMfaService(log).enable({ userId: consumed.userId, platformId: consumed.platformId, secret, confirmedStep: step })
        await endSessions({ userId: consumed.userId, log })
        const authentication = await authenticationUtils(log).getProjectAndToken({ userId: consumed.userId, platformId: consumed.platformId, projectId: consumed.projectId })
        return { recoveryCodes, authentication }
    },

    async status({ userId, platformId }: UserPlatformParams): Promise<MfaStatus> {
        const platform = await platformService(log).getOneWithPlanOrThrow(platformId)
        const { enabled, recoveryCodesRemaining } = await userMfaService(log).status({ userId })
        return { enabled, recoveryCodesRemaining, requiredByPlatform: ssoPolicy.isSsoActive({ platform }) }
    },

    async startSetup({ userId, platformId }: UserPlatformParams): Promise<MfaEnrollmentSecret> {
        if (await userMfaService(log).isEnabled({ userId })) {
            throw new ActivepiecesError({ code: ErrorCode.VALIDATION, params: { message: 'Two-factor authentication is already enabled' } })
        }
        const secret = totp.generateSecret()
        await authTransientStore.put({ key: setupKey({ userId }), value: await encryptUtils.encryptString(secret), ttlSeconds: SETUP_TTL_SECONDS })
        return { secret, otpauthUri: await otpauthUriFor({ userId, platformId, secret, log }) }
    },

    async confirmSetup({ userId, platformId, code }: UserPlatformParams & { code: string }): Promise<string[]> {
        const pending = await authTransientStore.get({ key: setupKey({ userId }), schema: EncryptedObject })
        if (isNil(pending)) {
            throw new ActivepiecesError({ code: ErrorCode.MFA_CHALLENGE_EXPIRED, params: {} })
        }
        const secret = await encryptUtils.decryptString(pending)
        const step = totp.findMatchingStep({ secret, code, nowMs: Date.now(), lastUsedStep: null })
        if (isNil(step)) {
            await recordUserFailure({ userId })
            throw invalidCode()
        }
        await authTransientStore.remove({ key: setupKey({ userId }) })
        const recoveryCodes = await userMfaService(log).enable({ userId, platformId, secret, confirmedStep: step })
        await endSessions({ userId, log })
        return recoveryCodes
    },

    async regenerateRecoveryCodes({ userId, code }: UserCodeParams): Promise<string[]> {
        await assertCodeForUser({ userId, code, log })
        return userMfaService(log).regenerateRecoveryCodes({ userId })
    },

    async disable({ userId, code }: UserCodeParams): Promise<void> {
        await assertCodeForUser({ userId, code, log })
        await userMfaService(log).remove({ userId })
        await endSessions({ userId, log })
    },

    async listEnrolledUserIds({ platformId }: { platformId: string }): Promise<string[]> {
        return userMfaService(log).listEnrolledUserIds({ platformId })
    },

    async resetForUser({ platformId, actorUserId, userId }: ResetForUserParams): Promise<void> {
        if (actorUserId === userId) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: { message: 'Use your own two-factor settings to change your second factor' },
            })
        }
        const target = await userRepo().findOneBy({ id: userId, platformId })
        if (isNil(target)) {
            throw new ActivepiecesError({ code: ErrorCode.ENTITY_NOT_FOUND, params: { entityType: 'user', entityId: userId } })
        }
        await userMfaService(log).remove({ userId: target.id })
        await endSessions({ userId: target.id, log })
        log.info({ user: { id: target.id }, platform: { id: platformId }, actor: { id: actorUserId } }, 'Two-factor authentication reset by platform admin')
    },
})

async function requirementFor({ userId, platformId, log }: UserPlatformParams & { log: FastifyBaseLogger }): Promise<MfaRequirement> {
    if (await userMfaService(log).isEnabled({ userId })) {
        return MfaRequirement.VERIFY
    }
    const platform = await platformService(log).getOneWithPlanOrThrow(platformId)
    return ssoPolicy.isSsoActive({ platform }) ? MfaRequirement.ENROLL : MfaRequirement.NONE
}

async function verifyForUser({ userId, code, log }: UserCodeParams & { log: FastifyBaseLogger }): Promise<boolean> {
    const attempts = await authTransientStore.increment({ key: userFailuresKey({ userId }), ttlSeconds: USER_FAILURE_WINDOW_SECONDS })
    if (attempts > MAX_USER_FAILURES) {
        log.warn({ user: { id: userId } }, 'Two-factor verification locked after too many failures')
        return false
    }
    const verified = await userMfaService(log).verify({ userId, code })
    if (verified) {
        await authTransientStore.decrement({ key: userFailuresKey({ userId }) })
    }
    return verified
}

async function endSessions({ userId, log }: { userId: string, log: FastifyBaseLogger }): Promise<void> {
    const user = await userService(log).getOneOrFail({ id: userId })
    await userIdentityService(log).rotateTokenVersion({ id: user.identityId })
}

async function assertCodeForUser({ userId, code, log }: UserCodeParams & { log: FastifyBaseLogger }): Promise<void> {
    const verified = await verifyForUser({ userId, code, log })
    if (!verified) {
        throw invalidCode()
    }
}

async function recordUserFailure({ userId }: { userId: string }): Promise<void> {
    await authTransientStore.increment({ key: userFailuresKey({ userId }), ttlSeconds: USER_FAILURE_WINDOW_SECONDS })
}

async function otpauthUriFor({ userId, platformId, secret, log }: OtpauthUriParams): Promise<string> {
    const user = await userService(log).getOneOrFail({ id: userId })
    const identity = await userIdentityService(log).getOneOrFail({ id: user.identityId })
    const platform = await platformService(log).getOneOrThrow(platformId)
    return totp.buildOtpauthUri({ secret, issuer: platform.name, accountName: identity.email })
}

function setupKey({ userId }: { userId: string }): string {
    return `mfa_setup:${userId}`
}

function userFailuresKey({ userId }: { userId: string }): string {
    return `mfa_user_failures:${userId}`
}

function invalidCode(): ActivepiecesError {
    return new ActivepiecesError({ code: ErrorCode.INVALID_OTP, params: {} })
}

function wrongChallengeStep(): ActivepiecesError {
    return new ActivepiecesError({ code: ErrorCode.VALIDATION, params: { message: 'This sign-in step does not apply to the current challenge' } })
}

enum MfaRequirement {
    NONE = 'NONE',
    VERIFY = 'VERIFY',
    ENROLL = 'ENROLL',
}

type IssueSessionParams = {
    userId: string
    platformId: string
    projectId: string | null
    provider: UserIdentityProvider
}

type UserPlatformParams = {
    userId: string
    platformId: string
}

type UserCodeParams = {
    userId: string
    code: string
}

type ChallengeCodeParams = {
    challengeToken: string
    code: string
}

type ResetForUserParams = {
    platformId: string
    actorUserId: string
    userId: string
}

type OtpauthUriParams = {
    userId: string
    platformId: string
    secret: string
    log: FastifyBaseLogger
}
