import { ActivepiecesError, apId, assertNotNullOrUndefined, ErrorCode, isNil, SeekPage, spreadIfDefined } from '@activepieces/core-utils'
import { InvitationStatus, InvitationType, PlatformRole, RemoveProjectFromInvitationResponse, TelemetryEventName, UserInvitation, UserInvitationWithLink } from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager, IsNull, ObjectLiteral } from 'typeorm'
import { userIdentityService } from '../authentication/user-identity/user-identity-service'
import { repoFactory } from '../core/db/repo-factory'
import { domainHelper } from '../helper/domain-helper'
import { JwtAudience, jwtUtils } from '../helper/jwt-utils'
import { buildPaginator } from '../helper/pagination/build-paginator'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { telemetry } from '../helper/telemetry.utils'
import { userService } from '../user/user-service'
import { UserInvitationEntity } from './user-invitation.entity'

export const userInvitationRepo = repoFactory(UserInvitationEntity)
const repo = userInvitationRepo

export const userInvitationsService = (log: FastifyBaseLogger) => ({
    async getOneByInvitationTokenOrThrow(invitationToken: string): Promise<UserInvitation> {
        const decodedToken = await jwtUtils.decodeAndVerify<UserInvitationToken>({
            jwt: invitationToken,
            key: await jwtUtils.getJwtSecret(),
            audience: JwtAudience.USER_INVITATION,
        })
        const invitation = await repo().findOneBy({
            id: decodedToken.id,
        })
        if (isNil(invitation)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: `id=${decodedToken.id}`,
                    entityType: 'UserInvitation',
                },
            })
        }
        return invitation
    },
    async provisionUserInvitation({ email }: ProvisionUserInvitationParams): Promise<void> {
        const invitations = await repo().createQueryBuilder('user_invitation')
            .where('LOWER("user_invitation"."email") = :email', { email: email.toLowerCase().trim() })
            .andWhere({
                status: InvitationStatus.ACCEPTED,
            })
            .getMany()

        if (invitations.length === 0) return

        const identity = await userIdentityService(log).getIdentityByEmail(email)
        if (isNil(identity)) return

        log.info({ count: invitations.length }, '[provisionUserInvitation] list invitations')
        for (const invitation of invitations) {
            log.info({ invitation }, '[provisionUserInvitation] provision')
            const { user } = await userService(log).getOrCreateWithProject({
                identity,
                platformId: invitation.platformId,
            })
            if (invitation.type === InvitationType.PLATFORM) {
                assertNotNullOrUndefined(invitation.platformRole, 'platformRole')
                await userService(log).update({
                    id: user.id,
                    platformId: invitation.platformId,
                    platformRole: invitation.platformRole,
                })
            }
            await deleteIfUnchanged({ invitation })
        }
    },
    async detachProjectFromPlatformInvites({ projectId, entityManager }: DetachProjectFromPlatformInvitesParams): Promise<void> {
        await repo(entityManager).update({ type: InvitationType.PLATFORM, projectId }, { projectId: null, projectRoleId: null })
    },
    async removeProjectFromPlatformInvite({ id, platformId, projectId }: RemoveProjectFromPlatformInviteParams): Promise<RemoveProjectFromInvitationResponse> {
        const cleared = await repo().createQueryBuilder()
            .update()
            .set({ projectId: null, projectRoleId: null, updated: () => '"updated"' })
            .where('"id" = :id AND "platformId" = :platformId AND "type" = :type AND "projectId" = :projectId', {
                id,
                platformId,
                type: InvitationType.PLATFORM,
                projectId,
            })
            .returning('*')
            .execute()
        const [clearedRow] = rowsOf(cleared)
        if (!isNil(clearedRow)) {
            return { revoked: false, invitation: { ...repo().create(clearedRow), projectRole: null } }
        }
        const invitation = await this.getOneOrThrow({ id, platformId })
        if (invitation.type !== InvitationType.PLATFORM) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: 'Only a platform invitation can have its project removed',
                },
            })
        }
        return { revoked: false, invitation }
    },
    async createInvitationRecord({
        email,
        platformId,
        projectId,
        type,
        projectRoleId,
        platformRole,
        status,
        entityManager,
    }: CreateInvitationRecordParams): Promise<UserInvitation> {
        const normalizedEmail = email.toLowerCase().trim()
        const invitedProject = await claimInvitedProject({ email: normalizedEmail, platformId, projectId, type, entityManager })
        const record = {
            status,
            type,
            email: normalizedEmail,
            platformId,
            projectRoleId: invitedProject.keepsProject ? projectRoleId : null,
            platformRole: type === InvitationType.PROJECT ? null : platformRole,
            projectId: invitedProject.keepsProject ? projectId : null,
        }
        switch (type) {
            case InvitationType.PLATFORM: {
                const replaced = await replacePlatformInvites({ email: normalizedEmail, platformId, entityManager })
                const resentStatus = replaced.wasAccepted ? InvitationStatus.ACCEPTED : status
                if (replaced.existed) {
                    await repo(entityManager).createQueryBuilder()
                        .update()
                        .set({
                            ...record,
                            status: () => 'CASE WHEN "status" = :acceptedStatus THEN :acceptedStatus ELSE :resentStatus END',
                            updated: dayjs().toISOString(),
                        })
                        .setParameters({ acceptedStatus: InvitationStatus.ACCEPTED, resentStatus })
                        .where({ id: replaced.id })
                        .execute()
                }
                else {
                    await repo(entityManager).save({
                        id: replaced.id,
                        ...record,
                        status: resentStatus,
                        updated: dayjs().toISOString(),
                    })
                }
                return this.getOneOrThrow({ id: replaced.id, platformId, entityManager })
            }
            case InvitationType.PROJECT: {
                const id = apId()
                await repo(entityManager).upsert({ id, ...record }, ['email', 'platformId', 'projectId'])
                return this.getOneOrThrow({ id, platformId, entityManager })
            }
        }
    },
    async finalizeInvitation({
        userInvitation,
        invitationExpirySeconds,
        resent,
    }: FinalizeInvitationParams): Promise<UserInvitationWithLink> {
        if (userInvitation.status === InvitationStatus.ACCEPTED) {
            const { registered } = await this.accept({
                invitationId: userInvitation.id,
                platformId: userInvitation.platformId,
            })
            if (resent && !registered) {
                return enrichWithInvitationLink(userInvitation, invitationExpirySeconds)
            }
            return { ...userInvitation, addedNow: registered }
        }
        return enrichWithInvitationLink(userInvitation, invitationExpirySeconds)
    },
    async list(params: ListUserParams): Promise<SeekPage<UserInvitation>> {
        const decodedCursor = paginationHelper.decodeCursor(params.cursor ?? null)
        const paginator = buildPaginator({
            entity: UserInvitationEntity,
            query: {
                limit: params.limit,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        const queryBuilder = repo().createQueryBuilder('user_invitation')
            .where({
                platformId: params.platformId,
                ...spreadIfDefined('projectId', params.projectId),
                ...spreadIfDefined('status', params.status),
                ...spreadIfDefined('type', params.type),
            })
        const { data, cursor } = await paginator.paginate(queryBuilder)
        const enrichedData = await Promise.all(data.map(async (invitation) => {
            return {
                projectRole: null,
                ...invitation,
            }
        }))
        return paginationHelper.createPage<UserInvitation>(await Promise.all(enrichedData), cursor)
    },
    async delete({ id, platformId }: PlatformAndIdParams): Promise<void> {
        const invitation = await this.getOneOrThrow({ id, platformId })
        await repo().delete({
            id: invitation.id,
            platformId,
        })
    },
    async getOneOrThrow({ id, platformId, entityManager }: PlatformAndIdParams): Promise<UserInvitation> {
        const invitation = await repo(entityManager).findOne({
            where: {
                id,
                platformId,
            },
        })
        if (isNil(invitation)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: `id=${id}`,
                    entityType: 'UserInvitation',
                },
            })
        }
        return invitation
    },
    async accept({ invitationId, platformId }: AcceptParams): Promise<AcceptResult> {
        const invitation = await this.getOneOrThrow({ id: invitationId, platformId })
        const firstAcceptance = invitation.status !== InvitationStatus.ACCEPTED
        await repo().update(invitation.id, {
            status: InvitationStatus.ACCEPTED,
        })
        if (firstAcceptance) {
            rejectedPromiseHandler(telemetry(log).trackPlatform({
                platformId,
                event: {
                    name: TelemetryEventName.INVITE_ACCEPTED,
                    payload: {
                        platformId,
                        type: invitation.type === InvitationType.PLATFORM ? 'platform' : 'project',
                    },
                },
            }), log)
        }
        const identity = await userIdentityService(log).getIdentityByEmail(invitation.email)
        if (isNil(identity)) {
            return { registered: false }
        }
        await this.provisionUserInvitation({
            email: invitation.email,
        })
        return { registered: true }
    },
    async getAcceptedAdminOrOperatorInviteRole({ email, platformId, entityManager }: GetAcceptedAdminOrOperatorInviteRoleParams): Promise<PlatformRole | null> {
        const latestInvitation = await repo(entityManager).createQueryBuilder('user_invitation')
            .where('LOWER("user_invitation"."email") = :email', { email: email.toLowerCase().trim() })
            .andWhere({
                platformId,
                type: InvitationType.PLATFORM,
                status: InvitationStatus.ACCEPTED,
            })
            .orderBy('"user_invitation"."updated"', 'DESC')
            .limit(1)
            .getOne()
        const latestRole = latestInvitation?.platformRole
        return latestRole === PlatformRole.ADMIN || latestRole === PlatformRole.OPERATOR ? latestRole : null
    },
    async deleteAcceptedPlatformInvites({ email, platformId }: DeleteAcceptedPlatformInvitesParams): Promise<void> {
        await repo().createQueryBuilder()
            .delete()
            .where('LOWER("email") = :email', { email: email.toLowerCase().trim() })
            .andWhere({ platformId, type: InvitationType.PLATFORM, status: InvitationStatus.ACCEPTED })
            .execute()
    },
    async hasAnyAcceptedInvitationsForEmail({ email }: { email: string }): Promise<boolean> {
        const count = await repo().createQueryBuilder('user_invitation')
            .where('LOWER("user_invitation"."email") = :email', { email: email.toLowerCase().trim() })
            .andWhere({ status: InvitationStatus.ACCEPTED })
            .getCount()
        return count > 0
    },
    async hasAnyAcceptedInvitations({
        email,
        platformId,
    }: HasAnyAcceptedInvitationsParams): Promise<boolean> {
        const invitations = await repo().createQueryBuilder().where({
            platformId,
            status: InvitationStatus.ACCEPTED,
        }).andWhere('LOWER(user_invitation.email) = :email', { email: email.toLowerCase().trim() })
            .getMany()
        return invitations.length > 0
    },
    async getByEmailAndPlatformIdOrThrow({
        email,
        platformId,
        projectId,
    }: GetOneByPlatformIdAndEmailParams): Promise<UserInvitation | null> {
        return repo().findOneBy({
            email,
            platformId,
            projectId: isNil(projectId) ? IsNull() : projectId,
        })
    },
})

export const INVITATION_EXPIRY_SECONDS = dayjs.duration(7, 'days').asSeconds()

export function getInvitationExpiryCutoff(): string {
    return dayjs().subtract(INVITATION_EXPIRY_SECONDS, 'seconds').toISOString()
}


async function replacePlatformInvites({ email, platformId, entityManager }: ReplacePlatformInvitesParams): Promise<ReplacedPlatformInvite> {
    const invitations = await repo(entityManager).find({
        where: { type: InvitationType.PLATFORM, email, platformId },
        order: { created: 'DESC' },
        lock: { mode: 'pessimistic_write' },
    })
    const [latest, ...duplicates] = invitations
    if (duplicates.length > 0) {
        await repo(entityManager).delete(duplicates.map((invitation) => invitation.id))
    }
    return {
        id: latest?.id ?? apId(),
        existed: !isNil(latest),
        wasAccepted: invitations.some((invitation) => invitation.status === InvitationStatus.ACCEPTED),
    }
}

async function deleteIfUnchanged({ invitation }: { invitation: UserInvitation }): Promise<void> {
    await repo().delete({
        id: invitation.id,
        status: invitation.status,
        platformRole: isNil(invitation.platformRole) ? IsNull() : invitation.platformRole,
        projectId: isNil(invitation.projectId) ? IsNull() : invitation.projectId,
        projectRoleId: isNil(invitation.projectRoleId) ? IsNull() : invitation.projectRoleId,
    })
}

function rowsOf(result: { raw: unknown }): ObjectLiteral[] {
    return Array.isArray(result.raw) ? result.raw : []
}

async function claimInvitedProject({ email, platformId, projectId, type, entityManager }: ClaimInvitedProjectParams): Promise<{ keepsProject: boolean }> {
    if (isNil(projectId)) {
        return { keepsProject: true }
    }
    switch (type) {
        case InvitationType.PROJECT: {
            await repo(entityManager).update(
                { type: InvitationType.PLATFORM, email, platformId, projectId },
                { projectId: null, projectRoleId: null },
            )
            return { keepsProject: true }
        }
        case InvitationType.PLATFORM: {
            await repo(entityManager).delete({ type: InvitationType.PROJECT, email, platformId, projectId, status: InvitationStatus.PENDING })
            const coveredByAcceptedProjectInvite = await repo(entityManager).existsBy({ type: InvitationType.PROJECT, email, platformId, projectId })
            return { keepsProject: !coveredByAcceptedProjectInvite }
        }
    }
}

async function generateInvitationLink(userInvitation: UserInvitation, expireyInSeconds: number): Promise<string> {
    const token = await jwtUtils.sign({
        payload: {
            id: userInvitation.id,
        },
        expiresInSeconds: expireyInSeconds,
        key: await jwtUtils.getJwtSecret(),
        audience: JwtAudience.USER_INVITATION,
    })

    return domainHelper.getPublicUrl({
        path: `invitation?token=${token}&email=${encodeURIComponent(userInvitation.email)}`,
    })
}
const enrichWithInvitationLink = async (userInvitation: UserInvitation, expireyInSeconds: number) => {
    const invitationLink = await generateInvitationLink(userInvitation, expireyInSeconds)
    return {
        ...userInvitation,
        link: invitationLink,
    }
}
type ReplacedPlatformInvite = {
    id: string
    existed: boolean
    wasAccepted: boolean
}

type ReplacePlatformInvitesParams = {
    email: string
    platformId: string
    entityManager?: EntityManager
}

type DetachProjectFromPlatformInvitesParams = {
    projectId: string
    entityManager: EntityManager
}





type ListUserParams = {
    platformId: string
    type: InvitationType
    projectId: string | null
    status?: InvitationStatus
    limit: number
    cursor: string | null
}

type HasAnyAcceptedInvitationsParams = {
    email: string
    platformId: string
}
type ProvisionUserInvitationParams = {
    email: string
}

type PlatformAndIdParams = {
    id: string
    platformId: string
    entityManager?: EntityManager
}

type RemoveProjectFromPlatformInviteParams = {
    id: string
    platformId: string
    projectId: string
}
export type UserInvitationToken = {
    id: string
}

type AcceptParams = {
    invitationId: string
    platformId: string
}

type AcceptResult = {
    registered: boolean
}

export type CreateInvitationRecordParams = {
    email: string
    platformId: string
    platformRole: PlatformRole | null
    projectId: string | null
    status: InvitationStatus
    type: InvitationType
    projectRoleId: string | null
    entityManager?: EntityManager
}

export type FinalizeInvitationParams = {
    userInvitation: UserInvitation
    invitationExpirySeconds: number
    resent: boolean
}

export type CountAdditionalSeatsNeededParams = {
    email: string
    platformId: string
    entityManager?: EntityManager
}

export type CountReservedSeatsParams = {
    platformId: string
    entityManager?: EntityManager
}

type GetOneByPlatformIdAndEmailParams = {
    email: string
    platformId: string
    projectId: string | null
}

type DeleteAcceptedPlatformInvitesParams = {
    email: string
    platformId: string
}

type GetAcceptedAdminOrOperatorInviteRoleParams = {
    email: string
    platformId: string
    entityManager?: EntityManager
}

type ClaimInvitedProjectParams = {
    email: string
    platformId: string
    projectId: string | null
    type: InvitationType
    entityManager?: EntityManager
}
