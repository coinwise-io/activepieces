import { isNil, Permission } from '@activepieces/core-utils'
import { FlowVersionState } from '@activepieces/shared'
import { flowVersionRepo } from '../flows/flow-version/flow-version.service'
import { accessPolicy, ProjectAccess } from './access-policy'

const VARIABLE_REFERENCE_GAP = '[^A-Za-z0-9_]{1,6}'

export const hiddenReferenceGuard = {
    async assertConnectionExternalIdFree({ access, projectId, externalId }: ConnectionParams): Promise<void> {
        const flows = await flowVersionRepo()
            .createQueryBuilder('fv')
            .innerJoin('flow', 'f', 'f.id = fv."flowId"')
            .select('f.id', 'id')
            .addSelect('f."folderId"', 'folderId')
            .where('f."projectId" = :projectId', { projectId })
            .andWhere('fv."connectionIds" @> ARRAY[:externalId]::varchar[]', { externalId })
            .andWhere('(fv.state = :draft OR f."publishedVersionId" = fv.id)', { draft: FlowVersionState.DRAFT })
            .distinct(true)
            .getRawMany<FlowRow>()
        assertAllEditable({ access, projectId, flows, permission: Permission.WRITE_APP_CONNECTION })
    },

    async assertVariableNameFree({ access, projectId, name }: VariableParams): Promise<void> {
        const flows = await flowVersionRepo()
            .createQueryBuilder('fv')
            .innerJoin('flow', 'f', 'f.id = fv."flowId"')
            .select('f.id', 'id')
            .addSelect('f."folderId"', 'folderId')
            .where('f."projectId" = :projectId', { projectId })
            .andWhere('fv.trigger::text ~ :pattern', { pattern: `variables${VARIABLE_REFERENCE_GAP}${escapeRegex({ value: name })}` })
            .andWhere('(fv.state = :draft OR f."publishedVersionId" = fv.id)', { draft: FlowVersionState.DRAFT })
            .distinct(true)
            .getRawMany<FlowRow>()
        assertAllEditable({ access, projectId, flows, permission: Permission.WRITE_VARIABLE })
    },
}

function assertAllEditable({ access, projectId, flows, permission }: AssertAllEditableParams): void {
    const allEditable = flows.every((flow) => accessPolicy.canOnFlow({
        access,
        flow: { id: flow.id, folderId: isNil(flow.folderId) ? null : flow.folderId },
        capability: 'EDIT',
    }))
    accessPolicy.assertCan({ allowed: allEditable, userId: access.userId, projectId, permission })
}

function escapeRegex({ value }: { value: string }): string {
    return value.replace(/[\\^$.|?*+()[\]{}]/g, (char) => `\\${char}`)
}

type FlowRow = {
    id: string
    folderId: string | null
}

type ConnectionParams = {
    access: ProjectAccess
    projectId: string
    externalId: string
}

type VariableParams = {
    access: ProjectAccess
    projectId: string
    name: string
}

type AssertAllEditableParams = {
    access: ProjectAccess
    projectId: string
    flows: FlowRow[]
    permission: Permission
}
