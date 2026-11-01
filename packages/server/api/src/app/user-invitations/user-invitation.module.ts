import { isNil, SeekPage } from '@activepieces/core-utils'
import { InvitationStatus, InvitationType, ListUserInvitationsRequest, Principal, PrincipalType, RemoveProjectFromInvitationResponse, SendUserInvitationRequest, SERVICE_KEY_SECURITY_OPENAPI, TelemetryEvent, TelemetryEventName, UserInvitation, UserInvitationWithLink } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { userIdentityService } from '../authentication/user-identity/user-identity-service'
import { transaction } from '../core/db/transaction'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { assertPlatformAdmin, featureDisabledError } from '../core/security/authorization/platform-authorization'
import { distributedLock } from '../database/redis-connections'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { telemetry } from '../helper/telemetry.utils'
import { userService } from '../user/user-service'
import { INVITATION_EXPIRY_SECONDS, userInvitationsService } from './user-invitation.service'

export const invitationModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(invitationController, { prefix: '/v1/user-invitations' })
}

const invitationController: FastifyPluginAsyncZod = async (app) => {

    app.post('/', UpsertUserInvitationRequestParams, async (request, reply) => {
        const { email, type } = request.body
        if (type === InvitationType.PROJECT || !isNil(request.body.projectId) || !isNil(request.body.projectRole)) {
            throw featureDisabledError()
        }
        await assertPlatformAdmin(request)
        const platformId = request.principal.platform.id
        const status = await shouldAutoAcceptInvitation(request.principal, request.body, platformId, request.log) ? InvitationStatus.ACCEPTED : InvitationStatus.PENDING

        const invitationRecordParams = {
            email,
            type,
            platformId,
            platformRole: request.body.platformRole,
            projectId: null,
            projectRoleId: null,
            status,
        }

        const userInvitationRecord = await distributedLock(request.log).runExclusive({
            key: `user-invitation:${platformId}:${email.toLowerCase().trim()}`,
            timeoutInSeconds: 30,
            fn: async () => {
                return transaction(async (entityManager) => userInvitationsService(request.log).createInvitationRecord({ ...invitationRecordParams, entityManager }))
            },
        })

        const invitation = await userInvitationsService(request.log).finalizeInvitation({
            userInvitation: userInvitationRecord,
            invitationExpirySeconds: INVITATION_EXPIRY_SECONDS,
            resent: status === InvitationStatus.PENDING && userInvitationRecord.status === InvitationStatus.ACCEPTED,
        })
        rejectedPromiseHandler(trackInviteSent({
            principal: request.principal,
            platformId,
            event: {
                name: TelemetryEventName.INVITE_SENT,
                payload: {
                    platformId,
                    type: 'platform',
                    role: request.body.platformRole ?? undefined,
                },
            },
            log: request.log,
        }), request.log)
        await reply.status(StatusCodes.CREATED).send(invitation)
    })

    app.get('/', ListUserInvitationsRequestParams, async (request, reply) => {
        const projectId = request.query.projectId === '' ? null : request.query.projectId
        if (request.query.type === InvitationType.PROJECT || (request.principal.type === PrincipalType.SERVICE && !isNil(projectId))) {
            throw featureDisabledError()
        }
        const invitations = await userInvitationsService(request.log).list({
            platformId: request.principal.platform.id,
            projectId: projectId ?? null,
            type: request.query.type,
            status: request.query.status,
            cursor: request.query.cursor ?? null,
            limit: request.query.limit ?? 10,
        })
        await reply.status(StatusCodes.OK).send(invitations)
    })

    app.post('/accept', AcceptUserInvitationRequestParams, async (request, reply) => {
        const invitation = await userInvitationsService(request.log).getOneByInvitationTokenOrThrow(request.body.invitationToken)
        const { registered } = await userInvitationsService(request.log).accept({
            invitationId: invitation.id,
            platformId: invitation.platformId,
        })
        await landNextSignInOnInvitedPlatform({ email: invitation.email, platformId: invitation.platformId, log: request.log })
        await reply.status(StatusCodes.OK).send({ ...invitation, registered })
    })

    app.post('/:id/remove-project', RemoveProjectFromInvitationRequestParams, async (request, reply) => {
        await assertPlatformAdmin(request)
        const result = await userInvitationsService(request.log).removeProjectFromPlatformInvite({
            id: request.params.id,
            platformId: request.principal.platform.id,
            projectId: request.body.projectId,
        })
        await reply.status(StatusCodes.OK).send(result)
    })

    app.delete('/:id', DeleteInvitationRequestParams, async (request, reply) => {
        const invitation = await userInvitationsService(request.log).getOneOrThrow({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        if (invitation.type === InvitationType.PROJECT) {
            throw featureDisabledError()
        }
        await assertPlatformAdmin(request)
        await userInvitationsService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        await reply.status(StatusCodes.NO_CONTENT).send()
    })
}


async function landNextSignInOnInvitedPlatform({ email, platformId, log }: LandNextSignInOnInvitedPlatformParams): Promise<void> {
    const identity = await userIdentityService(log).getIdentityByEmail(email)
    if (isNil(identity)) {
        return
    }
    await userIdentityService(log).updateLastLoggedInPlatformId({ id: identity.id, lastLoggedInPlatformId: platformId })
}

async function shouldAutoAcceptInvitation(principal: Principal, request: SendUserInvitationRequest, platformId: string, log: FastifyBaseLogger): Promise<boolean> {
    if (principal.type === PrincipalType.SERVICE) {
        return true
    }

    if (request.type === InvitationType.PLATFORM) {
        return false
    }

    const identity = await userIdentityService(log).getIdentityByEmail(request.email)
    if (isNil(identity)) {
        return false
    }

    const user = await userService(log).getOneByIdentityAndPlatform({
        identityId: identity.id,
        platformId,
    })
    return !isNil(user)
}

async function trackInviteSent({ principal, platformId, event, log }: TrackInviteSentParams): Promise<void> {
    if (principal.type === PrincipalType.USER) {
        await telemetry(log).trackUser({ userId: principal.id, platformId, event })
        return
    }
    await telemetry(log).trackPlatform({ platformId, event })
}

const ListUserInvitationsRequestParams = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE], {
            type: ProjectResourceType.QUERY,
            queryKey: 'projectId',
        }),
    },
    schema: {
        tags: ['user-invitations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListUserInvitationsRequest,
        response: {
            [StatusCodes.OK]: SeekPage(UserInvitation),
        },
    },
}

const AcceptUserInvitationRequestParams = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        body: z.object({
            invitationToken: z.string(),
        }),
    },
}

const DeleteInvitationRequestParams = {
    config: {
        security: securityAccess.unscoped([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['user-invitations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: z.string(),
        }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}

const RemoveProjectFromInvitationRequestParams = {
    config: {
        security: securityAccess.unscoped([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['user-invitations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Take the project off a platform invitation. When it is a Member invite and new members get no personal project and no default projects, the invitation is revoked instead, since they would have nowhere to land; their project invitations are not affected.',
        params: z.object({
            id: z.string(),
        }),
        body: z.object({
            projectId: z.string(),
        }),
        response: {
            [StatusCodes.OK]: RemoveProjectFromInvitationResponse,
        },
    },
}

const UpsertUserInvitationRequestParams = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE], {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        body: SendUserInvitationRequest,
        description: 'Send a user invitation to a user. If the user already has an invitation, the invitation will be updated.',
        tags: ['user-invitations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.CREATED]: UserInvitationWithLink,
        },
    },
}

type LandNextSignInOnInvitedPlatformParams = {
    email: string
    platformId: string
    log: FastifyBaseLogger
}


type TrackInviteSentParams = {
    principal: Principal
    platformId: string
    event: TelemetryEvent
    log: FastifyBaseLogger
}
