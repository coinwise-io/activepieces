import { ApId, isNil } from '@activepieces/core-utils'
import { ApplicationEventName, AuthenticationResponse, ConfirmMfaEnrollmentRequest, ConfirmMfaEnrollmentResponse, ListMfaEnrolledUsersResponse, MfaCodeRequest, MfaEnrollmentSecret, MfaRecoveryCodesResponse, MfaStatus, PrincipalType, StartMfaEnrollmentRequest, VerifyMfaChallengeRequest } from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { authnRateLimit } from '../../core/security/rate-limit'
import { applicationEvents } from '../../helper/application-events'
import { networkUtils } from '../../helper/network-utils'
import { mfaService } from './mfa.service'

export const mfaController: FastifyPluginAsyncZod = async (app) => {
    app.post('/verify', VerifyRequest, async (request) => {
        const response = await mfaService(request.log).verifyChallenge(request.body)
        recordSignIn({ request, response })
        return response
    })

    app.post('/enroll', StartEnrollmentRequest, async (request) => {
        return mfaService(request.log).startEnrollment(request.body)
    })

    app.post('/enroll/confirm', ConfirmEnrollmentRequest, async (request) => {
        const result = await mfaService(request.log).confirmEnrollment(request.body)
        recordSignIn({ request, response: result.authentication })
        return result
    })

    app.get('/status', StatusRequest, async (request) => {
        return mfaService(request.log).status({ userId: request.principal.id, platformId: request.principal.platform.id })
    })

    app.post('/setup', StartSetupRequest, async (request) => {
        return mfaService(request.log).startSetup({ userId: request.principal.id, platformId: request.principal.platform.id })
    })

    app.post('/setup/confirm', ConfirmSetupRequest, async (request) => {
        const recoveryCodes = await mfaService(request.log).confirmSetup({
            userId: request.principal.id,
            platformId: request.principal.platform.id,
            code: request.body.code,
        })
        return { recoveryCodes }
    })

    app.post('/recovery-codes', RegenerateRecoveryCodesRequest, async (request) => {
        const recoveryCodes = await mfaService(request.log).regenerateRecoveryCodes({ userId: request.principal.id, code: request.body.code })
        return { recoveryCodes }
    })

    app.post('/disable', DisableRequest, async (request, reply) => {
        await mfaService(request.log).disable({ userId: request.principal.id, code: request.body.code })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.get('/users', ListEnrolledUsersRequest, async (request) => {
        const userIds = await mfaService(request.log).listEnrolledUserIds({ platformId: request.principal.platform.id })
        return { userIds }
    })

    app.delete('/users/:userId', ResetForUserRequest, async (request, reply) => {
        await mfaService(request.log).resetForUser({
            platformId: request.principal.platform.id,
            actorUserId: request.principal.id,
            userId: request.params.userId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

function recordSignIn({ request, response }: { request: FastifyRequest, response: AuthenticationResponse }): void {
    if (isNil(response.platformId)) {
        return
    }
    applicationEvents(request.log).sendUserEvent({
        platformId: response.platformId,
        userId: response.id,
        projectId: response.projectId ?? undefined,
        ip: networkUtils.clientIp(request),
    }, {
        action: ApplicationEventName.USER_SIGNED_IN,
        data: {},
    })
}

const challengeConfig = {
    security: securityAccess.public(),
    rateLimit: authnRateLimit,
}

const signedInUserConfig = {
    security: securityAccess.publicPlatform([PrincipalType.USER]),
    rateLimit: authnRateLimit,
}

const VerifyRequest = {
    config: challengeConfig,
    schema: {
        tags: ['mfa'],
        description: 'Complete a sign-in with a TOTP or recovery code',
        body: VerifyMfaChallengeRequest,
    },
}

const StartEnrollmentRequest = {
    config: challengeConfig,
    schema: {
        tags: ['mfa'],
        description: 'Start the mandatory two-factor enrollment of a sign-in',
        body: StartMfaEnrollmentRequest,
        response: {
            [StatusCodes.OK]: MfaEnrollmentSecret,
        },
    },
}

const ConfirmEnrollmentRequest = {
    config: challengeConfig,
    schema: {
        tags: ['mfa'],
        description: 'Confirm the two-factor enrollment of a sign-in and get the session and recovery codes',
        body: ConfirmMfaEnrollmentRequest,
        response: {
            [StatusCodes.OK]: ConfirmMfaEnrollmentResponse,
        },
    },
}

const StatusRequest = {
    config: signedInUserConfig,
    schema: {
        tags: ['mfa'],
        description: 'Two-factor status of the signed-in user',
        response: {
            [StatusCodes.OK]: MfaStatus,
        },
    },
}

const StartSetupRequest = {
    config: signedInUserConfig,
    schema: {
        tags: ['mfa'],
        description: 'Start enabling two-factor authentication for the signed-in user',
        response: {
            [StatusCodes.OK]: MfaEnrollmentSecret,
        },
    },
}

const ConfirmSetupRequest = {
    config: signedInUserConfig,
    schema: {
        tags: ['mfa'],
        description: 'Confirm two-factor setup and get recovery codes',
        body: MfaCodeRequest,
        response: {
            [StatusCodes.OK]: MfaRecoveryCodesResponse,
        },
    },
}

const RegenerateRecoveryCodesRequest = {
    config: signedInUserConfig,
    schema: {
        tags: ['mfa'],
        description: 'Replace the recovery codes of the signed-in user',
        body: MfaCodeRequest,
        response: {
            [StatusCodes.OK]: MfaRecoveryCodesResponse,
        },
    },
}

const DisableRequest = {
    config: signedInUserConfig,
    schema: {
        tags: ['mfa'],
        description: 'Turn off two-factor authentication for the signed-in user',
        body: MfaCodeRequest,
    },
}

const ListEnrolledUsersRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['mfa'],
        description: 'List the users of the platform that have two-factor authentication enabled',
        response: {
            [StatusCodes.OK]: ListMfaEnrolledUsersResponse,
        },
    },
}

const ResetForUserRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['mfa'],
        description: 'Remove the second factor of another user of the platform',
        params: z.object({
            userId: ApId,
        }),
    },
}
