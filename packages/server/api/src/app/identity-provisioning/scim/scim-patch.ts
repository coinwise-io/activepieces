import { isNil } from '@activepieces/core-utils'
import { PlatformRole, SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA, SCIM_GROUP_SCHEMA, SCIM_USER_SCHEMA } from '@activepieces/shared'
import { z } from 'zod'
import { scimErrors } from './scim-errors'

const MAX_MEMBERS_PER_REQUEST = 1000
const ROOT_SCHEMA_PATHS: ReadonlySet<string> = new Set([SCIM_USER_SCHEMA, SCIM_GROUP_SCHEMA, SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA])
const EMAILS_PATH = /^emails(\[[^\]]*\])?(\.value)?$/i
const MEMBER_FILTER_PATH = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i
const PlatformRoleSchema = z.enum(PlatformRole)

function applyUserPatch({ operations, state }: { operations: ScimPatchOperationInput[], state: ScimUserPatchState }): ScimUserPatchState {
    return operations
        .flatMap((operation) => expandOperation({ operation }))
        .reduce((current, entry) => applyUserEntry({ state: current, entry }), state)
}

function applyGroupPatch({ operations, state }: { operations: ScimPatchOperationInput[], state: ScimGroupPatchState }): ScimGroupPatchState {
    return operations
        .flatMap((operation) => expandOperation({ operation }))
        .reduce((current, entry) => applyGroupEntry({ state: current, entry }), state)
}

function resolveEmail({ state }: { state: ScimUserPatchState }): string {
    if (state.userNameChanged) {
        return state.userName
    }
    return state.emailCandidate ?? state.userName
}

function parseBoolean({ value }: { value: unknown }): boolean {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') {
            return true
        }
        if (normalized === 'false') {
            return false
        }
    }
    throw scimErrors.badRequest({ detail: 'Expected a boolean value' })
}

function pickEmail({ emails }: { emails: unknown }): string | null {
    if (typeof emails === 'string') {
        return normalizeEmail({ value: emails })
    }
    const items = Array.isArray(emails) ? emails : [emails]
    const candidates = items.filter(isRecord).filter((item) => typeof item.value === 'string' && item.value.trim() !== '')
    const preferred = candidates.find((item) => parseLooseBoolean({ value: item.primary }))
        ?? candidates.find((item) => typeof item.type === 'string' && item.type.toLowerCase() === 'work')
        ?? candidates[0]
    if (isNil(preferred) || typeof preferred.value !== 'string') {
        return null
    }
    return normalizeEmail({ value: preferred.value })
}

function expandOperation({ operation }: { operation: ScimPatchOperationInput }): NormalizedEntry[] {
    const op = normalizeOp({ op: operation.op })
    const rawPath = (operation.path ?? '').trim()
    if (rawPath === '' || ROOT_SCHEMA_PATHS.has(rawPath)) {
        if (!isRecord(operation.value)) {
            throw scimErrors.badRequest({ detail: 'A patch operation without a path requires an object value', scimType: 'invalidSyntax' })
        }
        return Object.entries(operation.value).flatMap(([key, value]) => expandOperation({ operation: { op: operation.op, path: key, value } }))
    }
    return [{ op, path: stripSchemaPrefix({ path: rawPath }), value: operation.value }]
}

function normalizeOp({ op }: { op: string }): PatchOp {
    const normalized = op.trim().toLowerCase()
    if (normalized === 'add' || normalized === 'remove' || normalized === 'replace') {
        return normalized
    }
    throw scimErrors.badRequest({ detail: `Unsupported patch operation "${op}"`, scimType: 'invalidSyntax' })
}

function stripSchemaPrefix({ path }: { path: string }): string {
    if (!path.toLowerCase().startsWith('urn:')) {
        return path
    }
    const bracketIndex = path.indexOf('[')
    const head = bracketIndex === -1 ? path : path.slice(0, bracketIndex)
    const tail = bracketIndex === -1 ? '' : path.slice(bracketIndex)
    return head.slice(head.lastIndexOf(':') + 1) + tail
}

function applyUserEntry({ state, entry }: { state: ScimUserPatchState, entry: NormalizedEntry }): ScimUserPatchState {
    const path = entry.path.toLowerCase()
    const isRemove = entry.op === 'remove'
    if (path === 'active') {
        return isRemove ? state : { ...state, active: parseBoolean({ value: entry.value }) }
    }
    if (path === 'username') {
        if (isRemove) {
            return state
        }
        return { ...state, userName: requireEmail({ value: entry.value }), userNameChanged: true }
    }
    if (path === 'externalid') {
        return { ...state, externalId: isRemove ? null : requireString({ value: entry.value, field: 'externalId' }) }
    }
    if (path === 'name') {
        if (isRemove) {
            return { ...state, firstName: '', lastName: '' }
        }
        if (!isRecord(entry.value)) {
            throw scimErrors.badRequest({ detail: 'name must be an object' })
        }
        return {
            ...state,
            firstName: typeof entry.value.givenName === 'string' ? entry.value.givenName : state.firstName,
            lastName: typeof entry.value.familyName === 'string' ? entry.value.familyName : state.lastName,
        }
    }
    if (path === 'name.givenname') {
        return { ...state, firstName: isRemove ? '' : requireString({ value: entry.value, field: 'name.givenName' }) }
    }
    if (path === 'name.familyname') {
        return { ...state, lastName: isRemove ? '' : requireString({ value: entry.value, field: 'name.familyName' }) }
    }
    if (EMAILS_PATH.test(entry.path)) {
        if (isRemove) {
            return state
        }
        const email = pickEmail({ emails: entry.value })
        return isNil(email) ? state : { ...state, emailCandidate: email }
    }
    if (path === 'platformrole') {
        if (isRemove) {
            return state
        }
        const role = PlatformRoleSchema.safeParse(entry.value)
        if (!role.success) {
            throw scimErrors.badRequest({ detail: 'Invalid platformRole' })
        }
        return { ...state, platformRole: role.data }
    }
    return state
}

function applyGroupEntry({ state, entry }: { state: ScimGroupPatchState, entry: NormalizedEntry }): ScimGroupPatchState {
    const path = entry.path.toLowerCase()
    if (path === 'displayname') {
        if (entry.op === 'remove') {
            throw scimErrors.badRequest({ detail: 'displayName is required', scimType: 'mutability' })
        }
        return { ...state, displayName: requireString({ value: entry.value, field: 'displayName' }).trim() }
    }
    if (path === 'externalid') {
        return { ...state, externalId: entry.op === 'remove' ? null : requireString({ value: entry.value, field: 'externalId' }) }
    }
    if (path === 'members') {
        return { ...state, memberIds: applyMembers({ current: state.memberIds, op: entry.op, ids: entry.op === 'remove' && isNil(entry.value) ? null : extractMemberIds({ value: entry.value }) }) }
    }
    const filterMatch = entry.path.match(MEMBER_FILTER_PATH)
    if (filterMatch) {
        const id = filterMatch[1]
        const memberIds = entry.op === 'remove' ? state.memberIds.filter((memberId) => memberId !== id) : unique({ values: [...state.memberIds, id] })
        return { ...state, memberIds }
    }
    return state
}

function applyMembers({ current, op, ids }: { current: string[], op: PatchOp, ids: string[] | null }): string[] {
    if (op === 'replace') {
        return unique({ values: ids ?? [] })
    }
    if (op === 'add') {
        return unique({ values: [...current, ...(ids ?? [])] })
    }
    if (isNil(ids)) {
        return []
    }
    const removed = new Set(ids)
    return current.filter((memberId) => !removed.has(memberId))
}

function extractMemberIds({ value }: { value: unknown }): string[] {
    if (isNil(value)) {
        return []
    }
    const items = Array.isArray(value) ? value : [value]
    assertMemberCount({ count: items.length })
    return items.map((item) => {
        if (typeof item === 'string') {
            return item
        }
        if (isRecord(item) && typeof item.value === 'string') {
            return item.value
        }
        throw scimErrors.badRequest({ detail: 'Invalid members value' })
    })
}

function assertMemberCount({ count }: { count: number }): void {
    if (count > MAX_MEMBERS_PER_REQUEST) {
        throw scimErrors.badRequest({ detail: `A request can carry at most ${MAX_MEMBERS_PER_REQUEST} members`, scimType: 'tooMany' })
    }
}

function unique({ values }: { values: string[] }): string[] {
    return [...new Set(values)]
}

function requireString({ value, field }: { value: unknown, field: string }): string {
    if (typeof value !== 'string') {
        throw scimErrors.badRequest({ detail: `${field} must be a string` })
    }
    return value
}

function requireEmail({ value }: { value: unknown }): string {
    const email = normalizeEmail({ value: requireString({ value, field: 'userName' }) })
    if (isNil(email)) {
        throw scimErrors.badRequest({ detail: 'userName must be an email address' })
    }
    return email
}

function normalizeEmail({ value }: { value: string }): string | null {
    const email = value.trim().toLowerCase()
    return email.includes('@') ? email : null
}

function parseLooseBoolean({ value }: { value: unknown }): boolean {
    return value === true || (typeof value === 'string' && value.toLowerCase() === 'true')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const scimPatchUtils = {
    applyUserPatch,
    applyGroupPatch,
    resolveEmail,
    parseBoolean,
    pickEmail,
    assertMemberCount,
}

export type ScimPatchOperationInput = {
    op: string
    path?: string
    value?: unknown
}

export type ScimUserPatchState = {
    userName: string
    userNameChanged: boolean
    emailCandidate: string | null
    externalId: string | null
    firstName: string
    lastName: string
    active: boolean
    platformRole: PlatformRole | null
}

export type ScimGroupPatchState = {
    displayName: string
    externalId: string | null
    memberIds: string[]
}

type PatchOp = 'add' | 'remove' | 'replace'

type NormalizedEntry = {
    op: PatchOp
    path: string
    value: unknown
}
