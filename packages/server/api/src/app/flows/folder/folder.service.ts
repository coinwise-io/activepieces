import { ActivepiecesError, apId, Cursor, ErrorCode, isNil, Permission, ProjectId, SeekPage } from '@activepieces/core-utils'
import { CreateFolderRequest, Folder, FolderDto, FolderId, UpdateFolderRequest } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { accessPolicy, ProjectAccess } from '../../access-control/access-policy'
import { repoFactory } from '../../core/db/repo-factory'
import { distributedLock } from '../../database/redis-connections'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { tableService } from '../../tables/table/table.service'
import { flowService } from '../flow/flow.service'
import { FolderEntity } from './folder.entity'

export const folderRepo = repoFactory(FolderEntity)

async function refreshSocketAccess({ projectId, log }: { projectId: ProjectId, log: FastifyBaseLogger }): Promise<void> {
    const { websocketService } = await import('../../core/websockets.service')
    await websocketService.refreshAccessForProject({ projectId, log })
}

export const flowFolderService = (log: FastifyBaseLogger) => ({
    async delete(params: DeleteParams): Promise<void> {
        const { projectId, folderId } = params
        const folder = await this.getOneOrThrow({ projectId, folderId })
        await folderRepo().delete({
            id: folder.id,
            projectId,
        })
        await refreshSocketAccess({ projectId, log })
    },
    async update(params: UpdateParams): Promise<FolderDto> {
        const { projectId, folderId, request } = params
        const folder = await this.getOneOrThrow({ projectId, folderId })
        const folderWithDisplayName = await this.getOneByDisplayNameCaseInsensitive({
            projectId,
            displayName: request.displayName,
        })
        if (folderWithDisplayName && folderWithDisplayName.id !== folderId) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'Folder displayName is used' },
            })
        }
        await folderRepo().update(folder.id, {
            displayName: request.displayName,
        })
        return this.getOneOrThrow({ projectId, folderId })
    },
    async upsert(params: UpsertParams): Promise<FolderDto> {
        const { projectId, request } = params
        const existingFolder = await this.getOneByDisplayNameCaseInsensitive({ projectId, displayName: request.displayName })
        if (!isNil(existingFolder)) {
            return this.getOneOrThrow({ projectId, folderId: existingFolder.id })
        }
        return distributedLock(log).runExclusive({
            key: folderUpsertLockKey({ projectId, displayName: request.displayName }),
            timeoutInSeconds: FOLDER_UPSERT_LOCK_TIMEOUT_SECONDS,
            fn: async () => {
                const folderWithDisplayName = await this.getOneByDisplayNameCaseInsensitive({
                    projectId,
                    displayName: request.displayName,
                })
                if (!isNil(folderWithDisplayName)) {
                    return this.getOneOrThrow({ projectId, folderId: folderWithDisplayName.id })
                }
                const folderId = apId()
                await folderRepo().upsert({
                    id: folderId,
                    projectId,
                    displayName: request.displayName,
                    externalId: folderId,
                }, ['projectId', 'displayName'])
                const folder = await folderRepo().findOneByOrFail({ projectId, id: folderId })
                return {
                    ...folder,
                    numberOfFlows: 0,
                    numberOfTables: 0,
                }
            },
        })
    },
    async listAllByProject(params: ListAllParams): Promise<Folder[]> {
        const { projectId } = params
        return folderRepo().find({ where: { projectId } })
    },
    async upsertByExternalId(params: UpsertByExternalIdParams): Promise<Folder> {
        const { projectId, externalId, displayName, displayOrder } = params
        const existing = await folderRepo().findOneBy({ projectId, externalId })
        if (!isNil(existing)) {
            await folderRepo().update(existing.id, {
                displayName,
                displayOrder,
            })
            return folderRepo().findOneByOrFail({ id: existing.id, projectId })
        }
        const folderId = apId()
        await folderRepo().insert({
            id: folderId,
            projectId,
            displayName,
            displayOrder,
            externalId,
        })
        return folderRepo().findOneByOrFail({ id: folderId, projectId })
    },
    async deleteByExternalId(params: DeleteByExternalIdParams): Promise<void> {
        const { projectId, externalId } = params
        const existing = await folderRepo().findOneBy({ projectId, externalId })
        if (isNil(existing)) {
            return
        }
        await folderRepo().delete({ id: existing.id, projectId })
        await refreshSocketAccess({ projectId, log })
    },
    async list(params: ListParams): Promise<SeekPage<FolderDto>> {
        const { projectId, cursorRequest, limit, access } = params
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: FolderEntity,
            query: {
                limit,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        
        const visibleFlows = isNil(access) ? null : accessPolicy.flowCapabilityCondition({ access, flowAlias: 'flow', capability: 'SEE' })
        const queryBuilder = folderRepo()
            .createQueryBuilder('folder')
            .where('folder.projectId = :projectId', { projectId })
            .addSelect((subQuery) => {
                const countQuery = subQuery
                    .select('COUNT(*)::int')
                    .from('flow', 'flow')
                    .where('flow."folderId" = folder.id')
                return isNil(visibleFlows) ? countQuery : countQuery.andWhere(visibleFlows.sql, visibleFlows.params)
            }, 'numberOfFlows')
            .addSelect(
                canSeeTables({ access })
                    ? '(SELECT COUNT(*)::int FROM "table" tbl WHERE tbl."folderId" = folder.id)'
                    : '0',
                'numberOfTables',
            )

        if (!isNil(access)) {
            accessPolicy.applyFolderScope({ queryBuilder, access, folderAlias: 'folder', projectId })
        }

        const paginationResponse = await paginator.paginate<FolderDto>(queryBuilder)
        return paginationHelper.createPage(paginationResponse.data, paginationResponse.cursor)
    },
    async getOneByDisplayNameCaseInsensitive(params: GetOneByDisplayNameParams): Promise<Folder | null> {
        const { projectId, displayName } = params
        return folderRepo().createQueryBuilder('folder')
            .where('folder.projectId = :projectId', { projectId })
            .andWhere('LOWER(folder.displayName) = LOWER(:displayName)', { displayName })
            .getOne()
    },
    async getOneOrThrow(params: GetOneOrThrowParams): Promise<FolderDto> {
        const { projectId, folderId, access } = params
        const folder = await folderRepo().findOneBy({ projectId, id: folderId })
        if (!isNil(access) && !access.unrestricted) {
            await assertFolderVisible({ access, projectId, folderId })
        }
        if (!folder) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    message: `Folder ${folderId} is not found`,
                },
            })
        }
        const [numberOfFlows, numberOfTables] = await Promise.all([
            flowService(log).count({ projectId, folderId, access: access?.unrestricted ? undefined : access }),
            canSeeTables({ access }) ? tableService.count({ projectId, folderId }) : Promise.resolve(0),
        ])
        return {
            ...folder,
            numberOfFlows,
            numberOfTables,
        }
    },
})

function canSeeTables({ access }: { access: ProjectAccess | undefined }): boolean {
    return isNil(access) || access.unrestricted || accessPolicy.projectScopePermissions({ access }).includes(Permission.READ_TABLE)
}

async function assertFolderVisible({ access, projectId, folderId }: { access: ProjectAccess, projectId: ProjectId, folderId: FolderId }): Promise<void> {
    const queryBuilder = folderRepo()
        .createQueryBuilder('folder')
        .where('folder."projectId" = :projectId AND folder."id" = :folderId', { projectId, folderId })
    accessPolicy.applyFolderScope({ queryBuilder, access, folderAlias: 'folder', projectId })
    const visible = await queryBuilder.getExists()
    if (!visible) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: {
                message: `Folder ${folderId} is not found`,
            },
        })
    }
}

function folderUpsertLockKey({ projectId, displayName }: { projectId: ProjectId, displayName: string }): string {
    return `folder-upsert-${projectId}-${displayName.trim().toLowerCase()}`
}

const FOLDER_UPSERT_LOCK_TIMEOUT_SECONDS = 30

type DeleteParams = {
    projectId: ProjectId
    folderId: FolderId
}

type UpdateParams = {
    projectId: ProjectId
    folderId: FolderId
    request: UpdateFolderRequest
}

type UpsertParams = {
    projectId: ProjectId
    request: CreateFolderRequest
}

type ListParams = {
    projectId: ProjectId
    cursorRequest: Cursor | null
    limit: number
    access?: ProjectAccess
}

type GetOneByDisplayNameParams = {
    projectId: ProjectId
    displayName: string
}

type GetOneOrThrowParams = {
    projectId: ProjectId
    folderId: FolderId
    access?: ProjectAccess
}

type ListAllParams = {
    projectId: ProjectId
}

type UpsertByExternalIdParams = {
    projectId: ProjectId
    externalId: string
    displayName: string
    displayOrder: number
}

type DeleteByExternalIdParams = {
    projectId: ProjectId
    externalId: string
}