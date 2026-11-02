import { ActivepiecesError, apId, ErrorCode, isNil, isObject, Permission, ProjectId, unique } from '@activepieces/core-utils'
import {
    AccessGrant,
    AccessGrantPrincipal,
    AccessGrantScope,
    AccessGrantWithPrincipal,
    AccessPrincipalType,
    AccessRole,
    CreateAccessGrantRequest,
    EffectiveAccess,
    ListAccessGrantsRequest,
    ProjectType,
    UserStatus,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { In, IsNull } from 'typeorm'
import { flowRepo } from '../flows/flow/flow.repo'
import { folderRepo } from '../flows/folder/folder.service'
import { userGroupRepo } from '../identity-provisioning/user-group/user-group.service'
import { projectService } from '../project/project-service'
import { userRepo } from '../user/user-service'
import { accessPolicy, FlowRef, ProjectAccess } from './access-policy'
import { accessGrantRepo } from './access-resolver'

const MAX_PRINCIPALS_PER_TYPE = 50

export const accessGrantService = (log: FastifyBaseLogger) => ({
    async list({ projectId, access, request }: ListParams): Promise<AccessGrantWithPrincipal[]> {
        const target = await resolveTarget({ projectId, request })
        assertCanSeeTarget({ access, projectId, target })
        const queryBuilder = accessGrantRepo()
            .createQueryBuilder('ag')
            .where('ag."projectId" = :projectId', { projectId })
        if (!isNil(target.flow)) {
            queryBuilder.andWhere(
                `((ag."folderId" IS NULL AND ag."flowId" IS NULL) OR ag."flowId" = :flowId${isNil(target.flow.folderId) ? '' : ' OR (ag."folderId" = :flowFolderId AND ag."flowId" IS NULL)'})`,
                { flowId: target.flow.id, flowFolderId: target.flow.folderId },
            )
        }
        else if (!isNil(target.folderId)) {
            queryBuilder.andWhere(
                '((ag."folderId" IS NULL AND ag."flowId" IS NULL) OR (ag."folderId" = :folderId AND ag."flowId" IS NULL))',
                { folderId: target.folderId },
            )
        }
        else {
            queryBuilder.andWhere('ag."folderId" IS NULL AND ag."flowId" IS NULL')
        }
        const grants = await queryBuilder.orderBy('ag.created', 'ASC').addOrderBy('ag.id', 'ASC').getMany()
        return withPrincipals({ grants })
    },

    async create({ projectId, access, request, createdBy }: CreateParams): Promise<AccessGrantWithPrincipal> {
        const project = await projectService(log).getOneOrThrow(projectId)
        if (project.type !== ProjectType.TEAM) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Access can only be granted on team projects' },
            })
        }
        const target = await resolveTarget({ projectId, request })
        assertCanManage({ access, projectId, target })
        await assertPrincipalBelongsToPlatform({ platformId: project.platformId, principalType: request.principalType, principalId: request.principalId })

        const userId = request.principalType === AccessPrincipalType.USER ? request.principalId : null
        const groupId = request.principalType === AccessPrincipalType.GROUP ? request.principalId : null
        const folderId = isNil(target.flow) ? target.folderId : null
        const flowId = target.flow?.id ?? null

        const duplicateExists = await accessGrantRepo().existsBy({
            projectId,
            role: request.role,
            folderId: folderId ?? IsNull(),
            flowId: flowId ?? IsNull(),
            userId: userId ?? IsNull(),
            groupId: groupId ?? IsNull(),
        })
        if (duplicateExists) {
            throw duplicateGrantError()
        }

        const newGrant: AccessGrantInsert = {
            id: apId(),
            platformId: project.platformId,
            projectId,
            folderId,
            flowId,
            userId,
            groupId,
            role: request.role,
            createdBy,
        }
        try {
            await accessGrantRepo().insert(newGrant)
        }
        catch (error) {
            if (isUniqueViolation(error)) {
                throw duplicateGrantError()
            }
            throw error
        }
        const saved = await accessGrantRepo().findOneByOrFail({ id: newGrant.id, projectId })
        const [withPrincipal] = await withPrincipals({ grants: [saved] })
        log.info({ project: { id: projectId }, accessGrant: { id: saved.id, role: saved.role } }, 'Access grant created')
        return withPrincipal
    },

    async delete({ id, projectId, access }: DeleteParams): Promise<void> {
        const grant = await accessGrantRepo().findOneBy({ id, projectId })
        if (isNil(grant)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: id, entityType: 'access_grant' },
            })
        }
        const target = await resolveTarget({
            projectId,
            request: { projectId, folderId: grant.folderId ?? undefined, flowId: grant.flowId ?? undefined },
        })
        assertCanManage({ access, projectId, target })
        await accessGrantRepo().delete({ id, projectId })
        log.info({ project: { id: projectId }, accessGrant: { id } }, 'Access grant deleted')
    },

    async effective({ projectId, folderId, flowId, access }: EffectiveParams): Promise<EffectiveAccess> {
        if (!isNil(folderId) && !isNil(flowId)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Provide either folderId or flowId, not both' },
            })
        }
        if (!isNil(folderId)) {
            const target = await resolveTarget({ projectId, request: { projectId, folderId } })
            return {
                roles: accessPolicy.rolesOnFolder({ access, folderId }),
                permissions: accessPolicy.permissionsOnFolder({ access, folderId }),
                canManageAccess: accessPolicy.canManageAccess({ access, target: { folderId: target.folderId } }),
            }
        }
        if (isNil(flowId)) {
            return {
                roles: accessPolicy.rolesOnProject({ access }),
                permissions: access.permissions,
                canManageAccess: accessPolicy.canManageAccess({ access, target: {} }),
            }
        }
        const flow = await loadFlowRef({ projectId, flowId })
        return {
            roles: accessPolicy.rolesOnFlow({ access, flow }),
            permissions: accessPolicy.permissionsOnFlow({ access, flow }),
            canManageAccess: accessPolicy.canManageAccess({ access, target: { flow } }),
        }
    },

    async listPrincipals({ projectId, access, search }: ListPrincipalsParams): Promise<AccessGrantPrincipal[]> {
        if (!accessPolicy.canManageAccessAnywhere({ access })) {
            throw new ActivepiecesError({
                code: ErrorCode.PERMISSION_DENIED,
                params: { userId: access.userId ?? '', projectId, projectRole: null, permission: Permission.READ_PROJECT },
            })
        }
        const project = await projectService(log).getOneOrThrow(projectId)
        const pattern = isNil(search) || search.length === 0 ? null : `%${escapeLike(search)}%`

        const usersQuery = userRepo()
            .createQueryBuilder('usr')
            .innerJoin('usr.identity', 'identity')
            .select('usr.id', 'id')
            .addSelect('identity.email', 'email')
            .addSelect('identity.firstName', 'firstName')
            .addSelect('identity.lastName', 'lastName')
            .where('usr."platformId" = :platformId', { platformId: project.platformId })
            .andWhere('usr.status = :status', { status: UserStatus.ACTIVE })
        const groupsQuery = userGroupRepo()
            .createQueryBuilder('grp')
            .select('grp.id', 'id')
            .addSelect('grp.displayName', 'displayName')
            .where('grp."platformId" = :platformId', { platformId: project.platformId })
        if (!isNil(pattern)) {
            usersQuery.andWhere('(identity.email ILIKE :pattern ESCAPE \'\\\' OR identity."firstName" ILIKE :pattern ESCAPE \'\\\' OR identity."lastName" ILIKE :pattern ESCAPE \'\\\' OR CONCAT(identity."firstName", \' \', identity."lastName") ILIKE :pattern ESCAPE \'\\\')', { pattern })
            groupsQuery.andWhere('grp."displayName" ILIKE :pattern ESCAPE \'\\\'', { pattern })
        }
        const [users, groups] = await Promise.all([
            usersQuery.orderBy('identity.email', 'ASC').limit(MAX_PRINCIPALS_PER_TYPE).getRawMany<UserRow>(),
            groupsQuery.orderBy('grp."displayName"', 'ASC').limit(MAX_PRINCIPALS_PER_TYPE).getRawMany<GroupRow>(),
        ])
        return [
            ...users.map((row): AccessGrantPrincipal => ({ type: AccessPrincipalType.USER, id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName })),
            ...groups.map((row): AccessGrantPrincipal => ({ type: AccessPrincipalType.GROUP, id: row.id, displayName: row.displayName })),
        ]
    },
})

async function resolveTarget({ projectId, request }: { projectId: ProjectId, request: ListAccessGrantsRequest }): Promise<ResolvedTarget> {
    if (!isNil(request.folderId) && !isNil(request.flowId)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'Provide either folderId or flowId, not both' },
        })
    }
    if (!isNil(request.flowId)) {
        const flow = await loadFlowRef({ projectId, flowId: request.flowId })
        return { scope: AccessGrantScope.FLOW, folderId: null, flow }
    }
    if (!isNil(request.folderId)) {
        const folder = await folderRepo().findOneBy({ id: request.folderId, projectId })
        if (isNil(folder)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityId: request.folderId, entityType: 'folder' },
            })
        }
        return { scope: AccessGrantScope.FOLDER, folderId: folder.id, flow: null }
    }
    return { scope: AccessGrantScope.PROJECT, folderId: null, flow: null }
}

async function loadFlowRef({ projectId, flowId }: { projectId: ProjectId, flowId: string }): Promise<FlowRef> {
    const flow = await flowRepo().findOne({ select: { id: true, folderId: true }, where: { id: flowId, projectId } })
    if (isNil(flow)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { entityId: flowId, entityType: 'flow' },
        })
    }
    return { id: flow.id, folderId: flow.folderId ?? null }
}

function assertCanSeeTarget({ access, projectId, target }: { access: ProjectAccess, projectId: ProjectId, target: ResolvedTarget }): void {
    const allowed = !isNil(target.flow)
        ? accessPolicy.canOnFlow({ access, flow: target.flow, capability: 'SEE' })
        : !isNil(target.folderId)
            ? accessPolicy.canOnFolder({ access, folderId: target.folderId, capability: 'SEE' })
            : accessPolicy.canOnProject({ access, capability: 'SEE' })
    accessPolicy.assertCan({ allowed, userId: access.userId, projectId, permission: Permission.READ_PROJECT })
}

function assertCanManage({ access, projectId, target }: { access: ProjectAccess, projectId: ProjectId, target: ResolvedTarget }): void {
    accessPolicy.assertCan({
        allowed: accessPolicy.canManageAccess({ access, target: { folderId: target.folderId, flow: target.flow } }),
        userId: access.userId,
        projectId,
        permission: Permission.WRITE_PROJECT,
    })
}

async function assertPrincipalBelongsToPlatform({ platformId, principalType, principalId }: { platformId: string, principalType: AccessPrincipalType, principalId: string }): Promise<void> {
    const exists = principalType === AccessPrincipalType.USER
        ? await userRepo().existsBy({ id: principalId, platformId })
        : await userGroupRepo().existsBy({ id: principalId, platformId })
    if (!exists) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { entityId: principalId, entityType: principalType === AccessPrincipalType.USER ? 'user' : 'user_group' },
        })
    }
}

async function withPrincipals({ grants }: { grants: AccessGrant[] }): Promise<AccessGrantWithPrincipal[]> {
    const userIds = unique(grants.map((grant) => grant.userId).filter((id): id is string => !isNil(id)))
    const groupIds = unique(grants.map((grant) => grant.groupId).filter((id): id is string => !isNil(id)))
    const [users, groups] = await Promise.all([
        userIds.length === 0
            ? Promise.resolve<UserRow[]>([])
            : userRepo()
                .createQueryBuilder('usr')
                .innerJoin('usr.identity', 'identity')
                .select('usr.id', 'id')
                .addSelect('identity.email', 'email')
                .addSelect('identity.firstName', 'firstName')
                .addSelect('identity.lastName', 'lastName')
                .where({ id: In(userIds) })
                .getRawMany<UserRow>(),
        groupIds.length === 0
            ? Promise.resolve<GroupRow[]>([])
            : userGroupRepo()
                .createQueryBuilder('grp')
                .select('grp.id', 'id')
                .addSelect('grp.displayName', 'displayName')
                .where({ id: In(groupIds) })
                .getRawMany<GroupRow>(),
    ])
    const usersById = new Map(users.map((row) => [row.id, row]))
    const groupsById = new Map(groups.map((row) => [row.id, row]))
    return grants.flatMap((grant): AccessGrantWithPrincipal[] => {
        const user = isNil(grant.userId) ? undefined : usersById.get(grant.userId)
        const group = isNil(grant.groupId) ? undefined : groupsById.get(grant.groupId)
        const principal: AccessGrantPrincipal | null = !isNil(user)
            ? { type: AccessPrincipalType.USER, id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName }
            : !isNil(group)
                ? { type: AccessPrincipalType.GROUP, id: group.id, displayName: group.displayName }
                : null
        if (isNil(principal)) {
            return []
        }
        return [{ ...grant, scope: accessPolicy.scopeOf(grant), principal }]
    })
}

function duplicateGrantError(): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.VALIDATION,
        params: { message: 'This access grant already exists' },
    })
}

function isUniqueViolation(error: unknown): boolean {
    if (!isObject(error)) {
        return false
    }
    const driverError = 'driverError' in error ? error.driverError : null
    return error.code === '23505' || (isObject(driverError) && driverError.code === '23505')
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

type ResolvedTarget = {
    scope: AccessGrantScope
    folderId: string | null
    flow: FlowRef | null
}

type ListParams = {
    projectId: ProjectId
    access: ProjectAccess
    request: ListAccessGrantsRequest
}

type CreateParams = {
    projectId: ProjectId
    access: ProjectAccess
    request: CreateAccessGrantRequest
    createdBy: string | null
}

type DeleteParams = {
    id: string
    projectId: ProjectId
    access: ProjectAccess
}

type EffectiveParams = {
    projectId: ProjectId
    folderId: string | undefined
    flowId: string | undefined
    access: ProjectAccess
}

type ListPrincipalsParams = {
    projectId: ProjectId
    access: ProjectAccess
    search: string | undefined
}

type AccessGrantInsert = {
    id: string
    platformId: string
    projectId: string
    folderId: string | null
    flowId: string | null
    userId: string | null
    groupId: string | null
    role: AccessRole
    createdBy: string | null
}

type UserRow = {
    id: string
    email: string
    firstName: string
    lastName: string
}

type GroupRow = {
    id: string
    displayName: string
}
