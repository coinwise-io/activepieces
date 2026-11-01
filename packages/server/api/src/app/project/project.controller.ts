import { ActivepiecesError, ErrorCode, isNil, Permission, SeekPage, spreadIfDefined } from '@activepieces/core-utils'
import { CreatePlatformProjectRequest, ListProjectRequestForPlatformQueryParams, OPEN_SOURCE_PLAN, PiecesFilterType, Principal, PrincipalType, Project, ProjectType, ProjectWithLimits, ProjectWithLimitsWithPlatform, SERVICE_KEY_SECURITY_OPENAPI, UpdateProjectPlatformRequest } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { flowService } from '../flows/flow/flow.service'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { platformService } from '../platform/platform.service'
import { userService } from '../user/user-service'
import { projectService } from './project-service'

export const projectController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:id', GetProjectRequest, async (request) => {
        const project = await projectService(request.log).getOneOrThrow(request.projectId)
        const [withLimits] = await withLimitsAndAnalytics({ projects: [project], log: request.log })
        return withLimits
    })

    app.post('/', CreateProjectRequest, async (request, reply) => {
        const platformId = request.principal.platform.id
        await assertTeamProjectLimitNotReached({ platformId, log: request.log })
        const ownerId = await resolveUserId({ principal: request.principal, log: request.log })
        const project = await projectService(request.log).create({
            ownerId,
            platformId,
            displayName: request.body.displayName,
            type: ProjectType.TEAM,
            ...spreadIfDefined('externalId', request.body.externalId ?? undefined),
            ...spreadIfDefined('metadata', request.body.metadata ?? undefined),
            ...spreadIfDefined('maxConcurrentJobs', request.body.maxConcurrentJobs ?? undefined),
            ...spreadIfDefined('sensitive', request.body.sensitive),
        })
        const [withLimits] = await withLimitsAndAnalytics({ projects: [project], log: request.log })
        await reply.status(StatusCodes.CREATED).send(withLimits)
    })

    app.get('/', ListProjectsRequest, async (request) => {
        const userId = await resolveUserId({ principal: request.principal, log: request.log })
        const projects = await listProjectsForUser({
            platformId: request.principal.platform.id,
            userId,
            displayName: request.query.displayName,
            types: request.query.types,
            log: request.log,
        })
        const data = await withLimitsAndAnalytics({ projects, log: request.log })
        return paginationHelper.createPage(data, null)
    })

    app.post('/:id', UpdateProjectRequest, async (request) => {
        const project = await projectService(request.log).getOneOrThrow(request.projectId)
        if (request.body.isDefault === true) {
            throw new ActivepiecesError({
                code: ErrorCode.FEATURE_DISABLED,
                params: {
                    message: 'Default projects are not enabled for this platform',
                },
            })
        }
        const common = {
            externalId: request.body.externalId,
            notifyFlowOwnerOnFailure: request.body.notifyFlowOwnerOnFailure,
            metadata: request.body.metadata,
            maxConcurrentJobs: request.body.maxConcurrentJobs,
            executionDataRetentionDays: request.body.executionDataRetentionDays,
            sensitive: request.body.sensitive,
        }
        await projectService(request.log).update(project.id, project.type === ProjectType.TEAM
            ? { type: ProjectType.TEAM, ...common, displayName: request.body.displayName, icon: request.body.icon }
            : { type: ProjectType.PERSONAL, ...common })
        const updated = await projectService(request.log).getOneOrThrow(project.id)
        const [withLimits] = await withLimitsAndAnalytics({ projects: [updated], log: request.log })
        return withLimits
    })
}

export const platformListController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListPlatformsWithProjectsRequest, async (request) => {
        const loggedInUser = await userService(request.log).getOneOrFail({ id: request.principal.id })
        const platforms = await platformService(request.log).listPlatformsForIdentity({ identityId: loggedInUser.identityId })
        return Promise.all(platforms.map(async (platform) => {
            const platformUser = await userService(request.log).getOneByIdentityAndPlatform({ identityId: loggedInUser.identityId, platformId: platform.id })
            const projects = isNil(platformUser)
                ? []
                : await listProjectsForUser({ platformId: platform.id, userId: platformUser.id, log: request.log })
            return {
                platformId: platform.id,
                platformName: platform.name,
                projects: await withLimitsAndAnalytics({ projects, log: request.log }),
            }
        }))
    })
}

async function assertTeamProjectLimitNotReached({ platformId, log }: { platformId: string, log: FastifyBaseLogger }): Promise<void> {
    const limit = OPEN_SOURCE_PLAN.billedTeamProjectsLimit
    if (isNil(limit)) {
        return
    }
    const teamProjects = await projectService(log).countByPlatformIdAndType(platformId, ProjectType.TEAM)
    if (teamProjects >= limit) {
        throw new ActivepiecesError({
            code: ErrorCode.FEATURE_DISABLED,
            params: {
                message: `Maximum limit of ${limit} team project(s) reached for this plan.`,
            },
        })
    }
}

async function resolveUserId({ principal, log }: { principal: Principal, log: FastifyBaseLogger }): Promise<string> {
    if (principal.type === PrincipalType.SERVICE) {
        const platform = await platformService(log).getOneOrThrow(principal.platform.id)
        return platform.ownerId
    }
    return principal.id
}

async function listProjectsForUser({ platformId, userId, displayName, types, log }: ListProjectsForUserParams): Promise<Project[]> {
    const user = await userService(log).getOneOrFail({ id: userId })
    const projects = await projectService(log).getAllForUser({
        platformId,
        userId,
        isPrivileged: userService(log).isUserPrivileged(user),
        displayName,
    })
    const visible = projects.filter((project) => project.type !== ProjectType.PERSONAL || project.ownerId === userId)
    return isNil(types) || types.length === 0 ? visible : visible.filter((project) => types.includes(project.type))
}

async function withLimitsAndAnalytics({ projects, log }: { projects: Project[], log: FastifyBaseLogger }): Promise<ProjectWithLimits[]> {
    const projectIds = projects.map((project) => project.id)
    const [flowCounts, activeFlowCounts] = await Promise.all([
        flowService(log).countFlowsByProjects(projectIds),
        flowService(log).countActiveFlowsByProjects(projectIds),
    ])
    const platformUserCounts = new Map<string, number>()
    for (const platformId of new Set(projects.map((project) => project.platformId))) {
        platformUserCounts.set(platformId, await userService(log).countByPlatformId(platformId))
    }
    return projects.map(({ deleted: _deleted, ...project }) => ({
        ...project,
        plan: {
            id: project.id,
            created: project.created,
            updated: project.updated,
            projectId: project.id,
            locked: false,
            name: 'open-source',
            piecesFilterType: PiecesFilterType.NONE,
            pieces: [],
            activeFlowsLimit: null,
        },
        analytics: {
            totalUsers: platformUserCounts.get(project.platformId) ?? 0,
            activeUsers: platformUserCounts.get(project.platformId) ?? 0,
            totalFlows: flowCounts.get(project.id) ?? 0,
            activeFlows: activeFlowCounts.get(project.id) ?? 0,
            lastFlowUpdated: null,
        },
    }))
}

type ListProjectsForUserParams = {
    platformId: string
    userId: string
    displayName?: string
    types?: ProjectType[]
    log: FastifyBaseLogger
}

const GetProjectRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], undefined, {
            type: ProjectResourceType.PARAM,
            paramKey: 'id',
        }),
    },
    schema: {
        tags: ['projects'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: z.string(),
        }),
        response: {
            [StatusCodes.OK]: ProjectWithLimits,
        },
    },
}

const CreateProjectRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['projects'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: CreatePlatformProjectRequest,
        response: {
            [StatusCodes.CREATED]: ProjectWithLimits,
        },
    },
}

const ListProjectsRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['projects'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListProjectRequestForPlatformQueryParams,
        response: {
            [StatusCodes.OK]: SeekPage(ProjectWithLimits),
        },
    },
}

const UpdateProjectRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT, {
            type: ProjectResourceType.PARAM,
            paramKey: 'id',
        }),
    },
    schema: {
        tags: ['projects'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: z.string(),
        }),
        body: UpdateProjectPlatformRequest,
        response: {
            [StatusCodes.OK]: ProjectWithLimits,
        },
    },
}

const ListPlatformsWithProjectsRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
    schema: {
        response: {
            [StatusCodes.OK]: z.array(ProjectWithLimitsWithPlatform),
        },
    },
}
