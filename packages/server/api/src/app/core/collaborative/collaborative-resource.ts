import { isNil, Permission } from '@activepieces/core-utils'
import { FlowRef } from '../../access-control/access-policy'
import { databaseConnection } from '../../database/database-connection'
import { FlowEntity } from '../../flows/flow/flow.entity'
import { TableEntity } from '../../tables/table/table.entity'

const resolve = async ({ resourceId, projectId }: ResolveParams): Promise<CollaborativeResource | null> => {
    const flow = await databaseConnection().getRepository(FlowEntity).findOne({ select: { id: true, folderId: true }, where: { id: resourceId, projectId } })
    if (!isNil(flow)) {
        return { writePermission: Permission.WRITE_FLOW, flow: { id: flow.id, folderId: flow.folderId ?? null } }
    }
    const isTable = await databaseConnection().getRepository(TableEntity).existsBy({ id: resourceId, projectId })
    if (isTable) {
        return { writePermission: Permission.WRITE_TABLE, flow: null }
    }
    return null
}

export const collaborativeResource = { resolve }

export type CollaborativeResource = {
    writePermission: Permission
    flow: FlowRef | null
}

type ResolveParams = {
    resourceId: string
    projectId: string
}
