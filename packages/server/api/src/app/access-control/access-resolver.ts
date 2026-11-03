import { isNil, unique } from '@activepieces/core-utils'
import { AccessGrant, DefaultProjectRole, PlatformRole, Project, rolePermissions, User, UserStatus } from '@activepieces/shared'
import { repoFactory } from '../core/db/repo-factory'
import { AccessGrantEntity } from './access-grant.entity'
import { accessPolicy, ProjectAccess, ResolvedGrant } from './access-policy'

export const accessGrantRepo = repoFactory<AccessGrant>(AccessGrantEntity)

export const accessResolver = {
    async resolve({ user, project }: ResolveParams): Promise<ProjectAccess | null> {
        if (user.status !== UserStatus.ACTIVE || user.platformId !== project.platformId) {
            return null
        }
        if (user.id === project.ownerId) {
            return unrestricted({ userId: user.id, role: DefaultProjectRole.ADMIN })
        }
        switch (user.platformRole) {
            case PlatformRole.ADMIN:
                return unrestricted({ userId: user.id, role: DefaultProjectRole.ADMIN })
            case PlatformRole.OPERATOR:
                return unrestricted({ userId: user.id, role: DefaultProjectRole.EDITOR })
            default: {
                const grants = await listGrantsForUser({ userId: user.id, projectId: project.id, platformId: project.platformId })
                if (grants.length === 0) {
                    return null
                }
                return {
                    userId: user.id,
                    unrestricted: false,
                    permissions: accessPolicy.permissionsForGrants({ grants }),
                    grants,
                }
            }
        }
    },
    unrestrictedForNonUser(): ProjectAccess {
        return {
            userId: null,
            unrestricted: true,
            permissions: [],
            grants: [],
        }
    },
}

async function listGrantsForUser({ userId, projectId, platformId }: ListGrantsParams): Promise<ResolvedGrant[]> {
    const rows = await accessGrantRepo()
        .createQueryBuilder('ag')
        .select(['ag.role', 'ag.folderId', 'ag.flowId'])
        .where('ag."projectId" = :projectId', { projectId })
        .andWhere('ag."platformId" = :platformId', { platformId })
        .andWhere('(ag."userId" = :userId OR ag."groupId" IN (SELECT m."groupId" FROM "user_group_member" m WHERE m."userId" = :userId))', { userId })
        .getMany()
    const seen = unique(rows.map((row) => `${row.role}|${row.folderId ?? ''}|${row.flowId ?? ''}`))
    return seen.map((key) => rows.find((row) => `${row.role}|${row.folderId ?? ''}|${row.flowId ?? ''}` === key))
        .filter((row): row is AccessGrant => !isNil(row))
        .map((row) => ({ role: row.role, folderId: row.folderId ?? null, flowId: row.flowId ?? null }))
}

function unrestricted({ userId, role }: { userId: string, role: DefaultProjectRole }): ProjectAccess {
    return {
        userId,
        unrestricted: true,
        permissions: rolePermissions[role],
        grants: [],
    }
}

type ResolveParams = {
    user: User
    project: Project
}

type ListGrantsParams = {
    userId: string
    projectId: string
    platformId: string
}
