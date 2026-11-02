import { z } from 'zod'
import { AuthenticationResponse } from './authentication-response'

function isMfaChallenge(response: SignInResponse): response is MfaChallengeResponse {
    return 'mfaRequired' in response && response.mfaRequired === true
}

export const mfaUtils = {
    isMfaChallenge,
}

export const MfaChallengeResponse = z.object({
    mfaRequired: z.literal(true),
    challengeToken: z.string(),
    enrollmentRequired: z.boolean(),
})
export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponse>

export const SignInResponse = z.union([AuthenticationResponse, MfaChallengeResponse])
export type SignInResponse = z.infer<typeof SignInResponse>

export const MfaCode = z.string().trim().min(6).max(32)

export const VerifyMfaChallengeRequest = z.object({
    challengeToken: z.string().min(1).max(256),
    code: MfaCode,
})
export type VerifyMfaChallengeRequest = z.infer<typeof VerifyMfaChallengeRequest>

export const StartMfaEnrollmentRequest = z.object({
    challengeToken: z.string().min(1).max(256),
})
export type StartMfaEnrollmentRequest = z.infer<typeof StartMfaEnrollmentRequest>

export const MfaEnrollmentSecret = z.object({
    secret: z.string(),
    otpauthUri: z.string(),
})
export type MfaEnrollmentSecret = z.infer<typeof MfaEnrollmentSecret>

export const ConfirmMfaEnrollmentRequest = z.object({
    challengeToken: z.string().min(1).max(256),
    code: MfaCode,
})
export type ConfirmMfaEnrollmentRequest = z.infer<typeof ConfirmMfaEnrollmentRequest>

export const MfaRecoveryCodesResponse = z.object({
    recoveryCodes: z.array(z.string()),
})
export type MfaRecoveryCodesResponse = z.infer<typeof MfaRecoveryCodesResponse>

export const ConfirmMfaEnrollmentResponse = MfaRecoveryCodesResponse.extend({
    authentication: AuthenticationResponse,
})
export type ConfirmMfaEnrollmentResponse = z.infer<typeof ConfirmMfaEnrollmentResponse>

export const MfaCodeRequest = z.object({
    code: MfaCode,
})
export type MfaCodeRequest = z.infer<typeof MfaCodeRequest>

export const MfaStatus = z.object({
    enabled: z.boolean(),
    requiredByPlatform: z.boolean(),
    recoveryCodesRemaining: z.number(),
})
export type MfaStatus = z.infer<typeof MfaStatus>

export const ListMfaEnrolledUsersResponse = z.object({
    userIds: z.array(z.string()),
})
export type ListMfaEnrolledUsersResponse = z.infer<typeof ListMfaEnrolledUsersResponse>
