import { ActivepiecesError, ErrorCode, isNil, Permission, ProjectId, UserId } from '@activepieces/core-utils'
import { DefaultProjectRole, PlatformRole, Principal, PrincipalType, rolePermissions, User } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { ProjectAccess } from '../access-control/access-policy'
import { accessResolver } from '../access-control/access-resolver'
import { userService } from '../user/user-service'
import { projectService } from './project-service'

const resolvedByPrincipal = new WeakMap<Principal, Map<ProjectId, Promise<ProjectAccess | null>>>()

export const projectAccess = (log: FastifyBaseLogger) => ({
    async resolveForUser({ userId, projectId }: ResolveForUserParams): Promise<ProjectAccess | null> {
        const project = await projectService(log).getOneOrThrow(projectId)
        const user = await userService(log).getOneOrFail({ id: userId })
        return accessResolver.resolve({ user, project })
    },

    async resolveForPrincipal({ principal, projectId }: ResolveForPrincipalParams): Promise<ProjectAccess> {
        if (principal.type !== PrincipalType.USER) {
            return accessResolver.unrestrictedForNonUser()
        }
        const cache = resolvedByPrincipal.get(principal) ?? new Map<ProjectId, Promise<ProjectAccess | null>>()
        resolvedByPrincipal.set(principal, cache)
        const cached = cache.get(projectId) ?? this.resolveForUser({ userId: principal.id, projectId })
        cache.set(projectId, cached)
        const access = await cached
        if (isNil(access)) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: {
                    message: 'No role found for the user',
                    userId: principal.id,
                    projectId,
                },
            })
        }
        return access
    },

    async assertPrincipalAccessToProject({ principal, permission, projectId }: AssertPrincipalAccessParams): Promise<void> {
        switch (principal.type) {
            case PrincipalType.USER: {
                const access = await this.resolveForPrincipal({ principal, projectId })
                if (!isNil(permission) && !access.permissions.includes(permission)) {
                    throw new ActivepiecesError({
                        code: ErrorCode.PERMISSION_DENIED,
                        params: {
                            userId: principal.id,
                            projectId,
                            projectRole: null,
                            permission,
                        },
                    })
                }
                return
            }
            case PrincipalType.ENGINE: {
                if (principal.projectId !== projectId) {
                    throw new ActivepiecesError({
                        code: ErrorCode.AUTHORIZATION,
                        params: {
                            message: 'Engine is not allowed to access this project',
                            projectId,
                        },
                    })
                }
                return
            }
            case PrincipalType.SERVICE: {
                const project = await projectService(log).getOneOrThrow(projectId)
                if (project.platformId !== principal.platform.id) {
                    throw new ActivepiecesError({
                        code: ErrorCode.AUTHORIZATION,
                        params: {
                            message: 'Service is not allowed to access this project',
                            projectId,
                        },
                    })
                }
                return
            }
            default:
                throw new ActivepiecesError({
                    code: ErrorCode.AUTHORIZATION,
                    params: {
                        message: 'Principal is not allowed to access this project',
                        projectId,
                    },
                })
        }
    },

    hasPermissionOnAnyProject({ user, permission }: HasPermissionOnAnyProjectParams): boolean {
        const role = platformWideRoleOf(user)
        return !isNil(role) && rolePermissions[role].includes(permission)
    },
})

function platformWideRoleOf(user: User): DefaultProjectRole | null {
    switch (user.platformRole) {
        case PlatformRole.ADMIN:
            return DefaultProjectRole.ADMIN
        case PlatformRole.OPERATOR:
            return DefaultProjectRole.EDITOR
        default:
            return null
    }
}

type ResolveForUserParams = {
    userId: UserId
    projectId: ProjectId
}

type ResolveForPrincipalParams = {
    principal: Principal
    projectId: ProjectId
}

type AssertPrincipalAccessParams = {
    principal: Principal
    permission: Permission | undefined
    projectId: ProjectId
}

type HasPermissionOnAnyProjectParams = {
    user: User
    permission: Permission
}
