import { ActivepiecesError, ErrorCode, isNil, Permission } from '@activepieces/core-utils'
import { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { flowRepo } from '../flows/flow/flow.repo'
import { flowVersionRepo } from '../flows/flow-version/flow-version.service'
import { projectAccess } from '../project/project-access'
import { accessPolicy, Capability, FlowRef, ProjectAccess, RunScope } from './access-policy'

export const accessGuard = (log: FastifyBaseLogger) => ({
    async forRequest({ request }: { request: FastifyRequest }): Promise<ProjectAccess> {
        return projectAccess(log).resolveForPrincipal({ principal: request.principal, projectId: projectIdOf({ request }) })
    },

    async assertProjectForRequest({ request, capability, permission }: AssertProjectForRequestParams): Promise<void> {
        this.assertProject({
            access: await this.forRequest({ request }),
            projectId: projectIdOf({ request }),
            capability,
            permission,
        })
    },

    async forUser({ userId, projectId }: { userId: string, projectId: string }): Promise<ProjectAccess> {
        const access = await projectAccess(log).resolveForUser({ userId, projectId })
        if (isNil(access)) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: {
                    message: 'No role found for the user',
                    userId,
                    projectId,
                },
            })
        }
        return access
    },

    assertFlow({ access, projectId, flow, capability, permission }: AssertFlowParams): void {
        accessPolicy.assertCan({
            allowed: accessPolicy.canOnFlow({ access, flow, capability }),
            userId: access.userId,
            projectId,
            permission,
        })
    },

    assertProject({ access, projectId, capability, permission }: AssertProjectParams): void {
        accessPolicy.assertCan({
            allowed: accessPolicy.canOnProject({ access, capability }),
            userId: access.userId,
            projectId,
            permission,
        })
    },

    assertCanCreateFlow({ access, projectId, folderId }: { access: ProjectAccess, projectId: string, folderId: string | null }): void {
        accessPolicy.assertCan({
            allowed: accessPolicy.canCreateFlow({ access, folderId }),
            userId: access.userId,
            projectId,
            permission: Permission.WRITE_FLOW,
        })
    },

    async loadFlowRef({ projectId, flowId }: { projectId: string, flowId: string }): Promise<FlowRef> {
        const flow = await flowRepo().findOne({ select: { id: true, folderId: true }, where: { id: flowId, projectId } })
        if (isNil(flow)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: flowId,
                    entityType: 'flow',
                },
            })
        }
        return { id: flow.id, folderId: flow.folderId ?? null }
    },

    async assertFlowById({ access, projectId, flowId, capability, permission }: AssertFlowByIdParams): Promise<FlowRef> {
        const flow = await this.loadFlowRef({ projectId, flowId })
        this.assertFlow({ access, projectId, flow, capability, permission })
        return flow
    },

    async assertRun({ access, projectId, run, scope, permission }: AssertRunParams): Promise<void> {
        if (access.unrestricted) {
            return
        }
        const flow = await this.loadFlowRef({ projectId, flowId: run.flowId })
        accessPolicy.assertCan({
            allowed: accessPolicy.canReadRun({ access, flow, triggeredBy: run.triggeredBy, scope }),
            userId: access.userId,
            projectId,
            permission,
        })
    },

    async assertFlowByVersionId({ access, projectId, flowVersionId, capability, permission }: AssertFlowByVersionIdParams): Promise<FlowRef> {
        const version = await flowVersionRepo().findOne({ select: { id: true, flowId: true }, where: { id: flowVersionId } })
        if (isNil(version)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityId: flowVersionId,
                    entityType: 'flow_version',
                },
            })
        }
        return this.assertFlowById({ access, projectId, flowId: version.flowId, capability, permission })
    },
})

function projectIdOf({ request }: { request: FastifyRequest }): string {
    const projectId = request.projectId
    if (isNil(projectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'Project ID is required' },
        })
    }
    return projectId
}

type AssertProjectForRequestParams = {
    request: FastifyRequest
    capability: Capability
    permission?: Permission
}

type AssertFlowParams = {
    access: ProjectAccess
    projectId: string
    flow: FlowRef
    capability: Capability
    permission?: Permission
}

type AssertProjectParams = {
    access: ProjectAccess
    projectId: string
    capability: Capability
    permission?: Permission
}

type AssertFlowByIdParams = {
    access: ProjectAccess
    projectId: string
    flowId: string
    capability: Capability
    permission?: Permission
}

type AssertRunParams = {
    access: ProjectAccess
    projectId: string
    run: { flowId: string, triggeredBy?: string | null }
    scope: RunScope
    permission?: Permission
}

type AssertFlowByVersionIdParams = {
    access: ProjectAccess
    projectId: string
    flowVersionId: string
    capability: Capability
    permission?: Permission
}
