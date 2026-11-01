import { ActivepiecesError, ErrorCode, isNil, Permission, ProjectId, UserId } from '@activepieces/core-utils'
import { DefaultProjectRole, PlatformRole, Principal, PrincipalType, Project, rolePermissions, User } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { userService } from '../user/user-service'
import { projectService } from './project-service'

export const projectAccess = (log: FastifyBaseLogger) => ({
    async getRole({ userId, projectId }: GetRoleParams): Promise<DefaultProjectRole | null> {
        const project = await projectService(log).getOneOrThrow(projectId)
        const user = await userService(log).getOneOrFail({ id: userId })
        return roleOf({ user, project })
    },

    async assertPrincipalAccessToProject({ principal, permission, projectId }: AssertPrincipalAccessParams): Promise<void> {
        switch (principal.type) {
            case PrincipalType.USER: {
                const role = await this.getRole({ userId: principal.id, projectId })
                if (isNil(role)) {
                    throw new ActivepiecesError({
                        code: ErrorCode.AUTHORIZATION,
                        params: {
                            message: 'No role found for the user',
                            userId: principal.id,
                            projectId,
                        },
                    })
                }
                if (!isNil(permission) && !roleHasPermission({ role, permission })) {
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
        return !isNil(role) && roleHasPermission({ role, permission })
    },
})

function roleOf({ user, project }: { user: User, project: Project }): DefaultProjectRole | null {
    if (user.id === project.ownerId) {
        return DefaultProjectRole.ADMIN
    }
    if (user.platformId !== project.platformId) {
        return null
    }
    return platformWideRoleOf(user)
}

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

function roleHasPermission({ role, permission }: { role: DefaultProjectRole, permission: Permission }): boolean {
    return rolePermissions[role].includes(permission)
}

type GetRoleParams = {
    userId: UserId
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
