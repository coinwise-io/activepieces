import { apId, chunk, isNil } from '@activepieces/core-utils'
import { CreateScimGroupRequest, parseScimFilter, ReplaceScimGroupRequest, SCIM_GROUP_SCHEMA, SCIM_LIST_RESPONSE_SCHEMA } from '@activepieces/shared'
import { EntityManager, In } from 'typeorm'
import { z } from 'zod'
import { transaction } from '../../core/db/transaction'
import { userRepo } from '../../user/user-service'
import { UserGroupSchema } from '../user-group/user-group.entity'
import { userGroupMemberRepo, userGroupRepo } from '../user-group/user-group.service'
import { scimErrors } from './scim-errors'
import { ScimGroupPatchState, ScimPatchOperationInput, scimPatchUtils } from './scim-patch'

const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 100
const WRITE_CHUNK_SIZE = 500

export const scimGroupService = {
    async list({ platformId, filter, startIndex, count, baseUrl }: ListParams): Promise<ScimGroupListResult> {
        const displayName = parseScimFilter(filter, 'displayName')
        const externalId = parseScimFilter(filter, 'externalId')
        if (!isNil(filter) && filter.trim() !== '' && isNil(displayName) && isNil(externalId)) {
            throw scimErrors.badRequest({ detail: 'Only "displayName eq" and "externalId eq" filters are supported', scimType: 'invalidFilter' })
        }
        const query = userGroupRepo().createQueryBuilder('grp').where('grp.platformId = :platformId', { platformId })
        if (!isNil(displayName)) {
            query.andWhere('LOWER(grp.displayName) = :displayName', { displayName })
        }
        if (!isNil(externalId)) {
            query.andWhere('LOWER(grp.externalId) = :externalId', { externalId })
        }
        const pageSize = Math.min(Math.max(count ?? DEFAULT_PAGE_SIZE, 0), MAX_PAGE_SIZE)
        const start = Math.max(startIndex ?? 1, 1)
        const totalResults = await query.getCount()
        const groups = pageSize === 0
            ? []
            : await query.orderBy('grp.created', 'ASC').addOrderBy('grp.id', 'ASC').skip(start - 1).take(pageSize).getMany()
        const membersByGroup = await loadMemberIds({ groupIds: groups.map((group) => group.id) })
        return {
            schemas: [SCIM_LIST_RESPONSE_SCHEMA],
            totalResults,
            startIndex: start,
            itemsPerPage: groups.length,
            Resources: groups.map((group) => toResource({ group, memberIds: membersByGroup.get(group.id) ?? [], baseUrl })),
        }
    },
    async get({ platformId, id, baseUrl }: IdParams): Promise<ScimGroupResourceBody> {
        const group = await findGroupOrThrow({ platformId, id })
        const membersByGroup = await loadMemberIds({ groupIds: [group.id] })
        return toResource({ group, memberIds: membersByGroup.get(group.id) ?? [], baseUrl })
    },
    async create({ platformId, request, baseUrl }: CreateParams): Promise<ScimGroupResourceBody> {
        const displayName = requireDisplayName({ displayName: request.displayName })
        scimPatchUtils.assertMemberCount({ count: request.members?.length ?? 0 })
        const memberIds = [...new Set((request.members ?? []).map((member) => member.value))]
        await assertNamesAvailable({ platformId, displayName, externalId: request.externalId ?? null, groupId: null })
        await assertMembersBelongToPlatform({ platformId, userIds: memberIds })
        const groupId = apId()
        await transaction(async (entityManager) => {
            await userGroupRepo(entityManager).insert({ id: groupId, platformId, displayName, externalId: request.externalId ?? null })
            await insertMembers({ entityManager, groupId, userIds: memberIds })
        })
        return this.get({ platformId, id: groupId, baseUrl })
    },
    async replace({ platformId, id, request, baseUrl }: ReplaceParams): Promise<ScimGroupResourceBody> {
        scimPatchUtils.assertMemberCount({ count: request.members?.length ?? 0 })
        const group = await findGroupOrThrow({ platformId, id })
        const membersByGroup = await loadMemberIds({ groupIds: [group.id] })
        await persistState({
            platformId,
            group,
            currentMemberIds: membersByGroup.get(group.id) ?? [],
            next: {
                displayName: requireDisplayName({ displayName: request.displayName }),
                externalId: request.externalId ?? null,
                memberIds: [...new Set((request.members ?? []).map((member) => member.value))],
            },
        })
        return this.get({ platformId, id, baseUrl })
    },
    async patch({ platformId, id, operations, baseUrl }: PatchParams): Promise<ScimGroupResourceBody> {
        const group = await findGroupOrThrow({ platformId, id })
        const membersByGroup = await loadMemberIds({ groupIds: [group.id] })
        const currentMemberIds = membersByGroup.get(group.id) ?? []
        const next = scimPatchUtils.applyGroupPatch({
            operations,
            state: { displayName: group.displayName, externalId: group.externalId, memberIds: currentMemberIds },
        })
        await persistState({ platformId, group, currentMemberIds, next: { ...next, displayName: requireDisplayName({ displayName: next.displayName }) } })
        return this.get({ platformId, id, baseUrl })
    },
    async delete({ platformId, id }: { platformId: string, id: string }): Promise<void> {
        const result = await userGroupRepo().delete({ id, platformId })
        if (result.affected === 0) {
            throw scimErrors.notFound({ detail: `Group ${id} not found` })
        }
    },
}

async function findGroupOrThrow({ platformId, id }: { platformId: string, id: string }): Promise<UserGroupSchema> {
    const group = await userGroupRepo().findOneBy({ id, platformId })
    if (isNil(group)) {
        throw scimErrors.notFound({ detail: `Group ${id} not found` })
    }
    return group
}

async function loadMemberIds({ groupIds }: { groupIds: string[] }): Promise<Map<string, string[]>> {
    if (groupIds.length === 0) {
        return new Map()
    }
    const members = await userGroupMemberRepo().find({ where: { groupId: In(groupIds) }, order: { created: 'ASC', id: 'ASC' } })
    return members.reduce((acc, member) => {
        const existing = acc.get(member.groupId) ?? []
        return acc.set(member.groupId, [...existing, member.userId])
    }, new Map<string, string[]>())
}

async function persistState({ platformId, group, currentMemberIds, next }: PersistParams): Promise<void> {
    await assertNamesAvailable({ platformId, displayName: next.displayName, externalId: next.externalId, groupId: group.id })
    const current = new Set(currentMemberIds)
    const wanted = new Set(next.memberIds)
    const removed = currentMemberIds.filter((userId) => !wanted.has(userId))
    const added = next.memberIds.filter((userId) => !current.has(userId))
    await assertMembersBelongToPlatform({ platformId, userIds: added })
    await transaction(async (entityManager) => {
        await userGroupRepo(entityManager).update({ id: group.id, platformId }, { displayName: next.displayName, externalId: next.externalId })
        for (const userIds of chunk(removed, WRITE_CHUNK_SIZE)) {
            await userGroupMemberRepo(entityManager).delete({ groupId: group.id, userId: In(userIds) })
        }
        await insertMembers({ entityManager, groupId: group.id, userIds: added })
    })
}

async function insertMembers({ entityManager, groupId, userIds }: { entityManager: EntityManager, groupId: string, userIds: string[] }): Promise<void> {
    for (const batch of chunk(userIds, WRITE_CHUNK_SIZE)) {
        await userGroupMemberRepo(entityManager).insert(batch.map((userId) => ({ id: apId(), groupId, userId })))
    }
}

async function assertMembersBelongToPlatform({ platformId, userIds }: { platformId: string, userIds: string[] }): Promise<void> {
    const found = (await Promise.all(chunk(userIds, WRITE_CHUNK_SIZE).map((batch) => userRepo().find({ where: { platformId, id: In(batch) }, select: { id: true } })))).flat()
    const foundIds = new Set(found.map((user) => user.id))
    const unknown = userIds.filter((userId) => !foundIds.has(userId))
    if (unknown.length > 0) {
        throw scimErrors.badRequest({ detail: `Unknown member ids: ${unknown.join(', ')}` })
    }
}

async function assertNamesAvailable({ platformId, displayName, externalId, groupId }: { platformId: string, displayName: string, externalId: string | null, groupId: string | null }): Promise<void> {
    const sameName = await userGroupRepo().findOneBy({ platformId, displayName })
    if (!isNil(sameName) && sameName.id !== groupId) {
        throw scimErrors.conflict({ detail: `displayName ${displayName} already exists` })
    }
    if (isNil(externalId)) {
        return
    }
    const sameExternalId = await userGroupRepo().findOneBy({ platformId, externalId })
    if (!isNil(sameExternalId) && sameExternalId.id !== groupId) {
        throw scimErrors.conflict({ detail: `externalId ${externalId} already exists` })
    }
}

function requireDisplayName({ displayName }: { displayName: string }): string {
    const trimmed = displayName.trim()
    if (trimmed === '') {
        throw scimErrors.badRequest({ detail: 'displayName is required' })
    }
    return trimmed
}

function toResource({ group, memberIds, baseUrl }: { group: UserGroupSchema, memberIds: string[], baseUrl: string }): ScimGroupResourceBody {
    return {
        schemas: [SCIM_GROUP_SCHEMA],
        id: group.id,
        ...(isNil(group.externalId) ? {} : { externalId: group.externalId }),
        displayName: group.displayName,
        members: memberIds.map((userId) => ({ value: userId, $ref: `${baseUrl}Users/${userId}`, type: 'User' })),
        meta: {
            resourceType: 'Group',
            created: new Date(group.created).toISOString(),
            lastModified: new Date(group.updated).toISOString(),
            location: `${baseUrl}Groups/${group.id}`,
        },
    }
}

export const ScimCreateGroupBody = CreateScimGroupRequest.extend({
    schemas: z.array(z.string()).optional(),
})

export const ScimReplaceGroupBody = ReplaceScimGroupRequest.extend({
    schemas: z.array(z.string()).optional(),
})

export type ScimCreateGroupBody = z.infer<typeof ScimCreateGroupBody>
export type ScimReplaceGroupBody = z.infer<typeof ScimReplaceGroupBody>

type ScimGroupResourceBody = Record<string, unknown>

type ScimGroupListResult = {
    schemas: string[]
    totalResults: number
    startIndex: number
    itemsPerPage: number
    Resources: ScimGroupResourceBody[]
}

type IdParams = {
    platformId: string
    id: string
    baseUrl: string
}

type ListParams = {
    platformId: string
    filter: string | undefined
    startIndex: number | undefined
    count: number | undefined
    baseUrl: string
}

type CreateParams = {
    platformId: string
    request: ScimCreateGroupBody
    baseUrl: string
}

type ReplaceParams = IdParams & {
    request: ScimReplaceGroupBody
}

type PatchParams = IdParams & {
    operations: ScimPatchOperationInput[]
}

type PersistParams = {
    platformId: string
    group: UserGroupSchema
    currentMemberIds: string[]
    next: ScimGroupPatchState
}
