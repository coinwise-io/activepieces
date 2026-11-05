import { isNil, tryCatch } from '@activepieces/core-utils'
import { PopulatedFlow } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { accessPolicy, ProjectAccess } from '../access-control/access-policy'
import { projectAccess } from '../project/project-access'

export const mcpFlowAccess = {
    async resolve({ userId, projectId, log }: { userId: string | undefined, projectId: string, log: FastifyBaseLogger }): Promise<ProjectAccess | null> {
        if (isNil(userId)) {
            return null
        }
        const { data } = await tryCatch(() => projectAccess(log).resolveForUser({ userId, projectId }))
        return data ?? null
    },
    canRun({ access, flow }: { access: ProjectAccess, flow: PopulatedFlow }): boolean {
        return accessPolicy.canOnFlow({ access, flow: { id: flow.id, folderId: flow.folderId ?? null }, capability: 'EXECUTE' })
    },
}
