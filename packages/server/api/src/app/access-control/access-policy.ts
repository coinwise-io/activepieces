import { ActivepiecesError, ErrorCode, isNil, Permission, unique } from '@activepieces/core-utils'
import { AccessGrantScope, AccessRole, DefaultProjectRole, rolePermissions } from '@activepieces/shared'
import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm'

const ALL_ROLES: AccessRole[] = [AccessRole.EDITOR, AccessRole.EXECUTOR, AccessRole.HISTORY_READER]

const CAPABILITY_ROLES: Record<Capability, AccessRole[]> = {
    SEE: ALL_ROLES,
    EDIT: [AccessRole.EDITOR],
    EXECUTE: [AccessRole.EDITOR, AccessRole.EXECUTOR],
    READ_RUNS: [AccessRole.EDITOR, AccessRole.HISTORY_READER],
}

const RUN_SCOPE_ROLES: Record<RunScope, { all: AccessRole[], own: AccessRole[] }> = {
    READ: { all: [AccessRole.EDITOR, AccessRole.HISTORY_READER], own: [AccessRole.EXECUTOR] },
    RETRY: { all: [AccessRole.EDITOR], own: [AccessRole.EXECUTOR] },
    MANAGE: { all: [AccessRole.EDITOR], own: [] },
}

const READ_ONLY_PERMISSIONS: Permission[] = [
    Permission.READ_PROJECT,
    Permission.READ_FLOW,
    Permission.READ_FOLDER,
    Permission.READ_RUN,
]

const PROJECT_ROLE_PERMISSIONS: Record<AccessRole, Permission[]> = {
    [AccessRole.EDITOR]: rolePermissions[DefaultProjectRole.EDITOR],
    [AccessRole.HISTORY_READER]: READ_ONLY_PERMISSIONS,
    [AccessRole.EXECUTOR]: [...READ_ONLY_PERMISSIONS, Permission.EXECUTE_FLOW],
}

const NARROW_EDITOR_PERMISSIONS: Permission[] = [
    Permission.WRITE_FLOW,
    Permission.UPDATE_FLOW_STATUS,
    Permission.WRITE_RUN,
    Permission.EXECUTE_FLOW,
    Permission.READ_APP_CONNECTION,
    Permission.WRITE_APP_CONNECTION,
    Permission.READ_VARIABLE,
    Permission.WRITE_VARIABLE,
]

const NARROW_EXECUTOR_PERMISSIONS: Permission[] = [Permission.EXECUTE_FLOW]

const FLOW_PERMISSION_CAPABILITY: Partial<Record<Permission, Capability>> = {
    [Permission.READ_FLOW]: 'SEE',
    [Permission.WRITE_FLOW]: 'EDIT',
    [Permission.UPDATE_FLOW_STATUS]: 'EDIT',
    [Permission.WRITE_RUN]: 'EDIT',
    [Permission.EXECUTE_FLOW]: 'EXECUTE',
    [Permission.READ_RUN]: 'SEE',
}

function isProjectScope(grant: ResolvedGrant): boolean {
    return isNil(grant.folderId) && isNil(grant.flowId)
}

function scopeOf(grant: { folderId?: string | null, flowId?: string | null }): AccessGrantScope {
    if (!isNil(grant.flowId)) {
        return AccessGrantScope.FLOW
    }
    if (!isNil(grant.folderId)) {
        return AccessGrantScope.FOLDER
    }
    return AccessGrantScope.PROJECT
}

function permissionsForGrants({ grants }: { grants: ResolvedGrant[] }): Permission[] {
    const projectPermissions = grants
        .filter(isProjectScope)
        .flatMap((grant) => PROJECT_ROLE_PERMISSIONS[grant.role])
    const narrow = grants.filter((grant) => !isProjectScope(grant))
    const narrowPermissions = narrow.length === 0
        ? []
        : [
            ...READ_ONLY_PERMISSIONS,
            ...(narrow.some((grant) => grant.role === AccessRole.EDITOR) ? NARROW_EDITOR_PERMISSIONS : []),
            ...(narrow.some((grant) => grant.role === AccessRole.EXECUTOR) ? NARROW_EXECUTOR_PERMISSIONS : []),
        ]
    return unique([...projectPermissions, ...narrowPermissions])
}

function projectScopePermissions({ access }: { access: ProjectAccess }): Permission[] {
    if (access.unrestricted) {
        return access.permissions
    }
    return permissionsForGrants({ grants: access.grants.filter(isProjectScope) })
}

function rolesOnProject({ access }: { access: ProjectAccess }): AccessRole[] {
    if (access.unrestricted) {
        return [AccessRole.EDITOR]
    }
    return unique(access.grants.filter(isProjectScope).map((grant) => grant.role))
}

function rolesOnFolder({ access, folderId }: { access: ProjectAccess, folderId: string | null }): AccessRole[] {
    if (access.unrestricted) {
        return [AccessRole.EDITOR]
    }
    return unique(access.grants
        .filter((grant) => isProjectScope(grant) || (!isNil(folderId) && grant.folderId === folderId && isNil(grant.flowId)))
        .map((grant) => grant.role))
}

function rolesOnFlow({ access, flow }: { access: ProjectAccess, flow: FlowRef }): AccessRole[] {
    if (access.unrestricted) {
        return [AccessRole.EDITOR]
    }
    return unique(access.grants
        .filter((grant) => isProjectScope(grant)
            || (!isNil(grant.flowId) && grant.flowId === flow.id)
            || (isNil(grant.flowId) && !isNil(grant.folderId) && grant.folderId === flow.folderId))
        .map((grant) => grant.role))
}

function hasCapability({ roles, capability }: { roles: AccessRole[], capability: Capability }): boolean {
    return roles.some((role) => CAPABILITY_ROLES[capability].includes(role))
}

function canOnFlow({ access, flow, capability }: CanOnFlowParams): boolean {
    return hasCapability({ roles: rolesOnFlow({ access, flow }), capability })
}

function permissionsOnFlow({ access, flow }: { access: ProjectAccess, flow: FlowRef }): Permission[] {
    if (access.unrestricted) {
        return access.permissions
    }
    return access.permissions.filter((permission) => {
        const required = FLOW_PERMISSION_CAPABILITY[permission]
        return isNil(required) || canOnFlow({ access, flow, capability: required })
    })
}

function permissionsOnFolder({ access, folderId }: { access: ProjectAccess, folderId: string }): Permission[] {
    if (access.unrestricted) {
        return access.permissions
    }
    return access.permissions.filter((permission) => {
        const required = FLOW_PERMISSION_CAPABILITY[permission]
        return isNil(required) || canOnFolder({ access, folderId, capability: required })
    })
}

function canOnProject({ access, capability }: { access: ProjectAccess, capability: Capability }): boolean {
    return hasCapability({ roles: rolesOnProject({ access }), capability })
}

function canOnFolder({ access, folderId, capability }: { access: ProjectAccess, folderId: string | null, capability: Capability }): boolean {
    return hasCapability({ roles: rolesOnFolder({ access, folderId }), capability })
}

function canCreateFlow({ access, folderId }: { access: ProjectAccess, folderId: string | null }): boolean {
    return canOnFolder({ access, folderId, capability: 'EDIT' })
}

function canReadRun({ access, flow, triggeredBy, scope }: CanReadRunParams): boolean {
    const roles = rolesOnFlow({ access, flow })
    const { all, own } = RUN_SCOPE_ROLES[scope]
    if (roles.some((role) => all.includes(role))) {
        return true
    }
    return !isNil(access.userId) && triggeredBy === access.userId && roles.some((role) => own.includes(role))
}

function canManageAccess({ access, target }: { access: ProjectAccess, target: ManageTarget }): boolean {
    if (!isNil(target.flow)) {
        return canOnFlow({ access, flow: target.flow, capability: 'EDIT' })
    }
    if (!isNil(target.folderId)) {
        return canOnFolder({ access, folderId: target.folderId, capability: 'EDIT' })
    }
    return canOnProject({ access, capability: 'EDIT' })
}

function canManageAccessAnywhere({ access }: { access: ProjectAccess }): boolean {
    return access.unrestricted || access.grants.some((grant) => grant.role === AccessRole.EDITOR)
}

function scopeFor({ access, roles }: { access: ProjectAccess, roles: AccessRole[] }): GrantScopeSet {
    if (access.unrestricted) {
        return { projectWide: true, flowIds: [], folderIds: [] }
    }
    const matching = access.grants.filter((grant) => roles.includes(grant.role))
    return {
        projectWide: matching.some(isProjectScope),
        flowIds: unique(matching.map((grant) => grant.flowId).filter((id): id is string => !isNil(id))),
        folderIds: unique(matching.filter((grant) => isNil(grant.flowId)).map((grant) => grant.folderId).filter((id): id is string => !isNil(id))),
    }
}

function flowScopeCondition({ scope, flowIdColumn, flowTable, projectId, prefix }: FlowScopeConditionParams): Condition | null {
    const clauses = [
        ...(scope.flowIds.length > 0 ? [`${flowIdColumn} IN (:...${prefix}FlowIds)`] : []),
        ...(scope.folderIds.length > 0 ? [`${flowIdColumn} IN (SELECT "${prefix}_f"."id" FROM "${flowTable}" "${prefix}_f" WHERE "${prefix}_f"."projectId" = :${prefix}ProjectId AND "${prefix}_f"."folderId" IN (:...${prefix}FolderIds))`] : []),
    ]
    if (clauses.length === 0) {
        return null
    }
    return {
        sql: `(${clauses.join(' OR ')})`,
        params: {
            [`${prefix}FlowIds`]: scope.flowIds,
            [`${prefix}FolderIds`]: scope.folderIds,
            [`${prefix}ProjectId`]: projectId,
        },
    }
}

function flowCapabilityCondition({ access, flowAlias, capability }: { access: ProjectAccess, flowAlias: string, capability: Capability }): Condition | null {
    if (access.unrestricted) {
        return null
    }
    const scope = scopeFor({ access, roles: CAPABILITY_ROLES[capability] })
    if (scope.projectWide) {
        return null
    }
    const clauses = [
        ...(scope.flowIds.length > 0 ? [{ sql: `${flowAlias}."id" IN (:...scopeFlowIds)`, params: { scopeFlowIds: scope.flowIds } }] : []),
        ...(scope.folderIds.length > 0 ? [{ sql: `${flowAlias}."folderId" IN (:...scopeFolderIds)`, params: { scopeFolderIds: scope.folderIds } }] : []),
    ]
    if (clauses.length === 0) {
        return { sql: '1 = 0', params: {} }
    }
    return {
        sql: `(${clauses.map((clause) => clause.sql).join(' OR ')})`,
        params: Object.assign({}, ...clauses.map((clause) => clause.params)),
    }
}

function applyFlowScope<T extends ObjectLiteral>({ queryBuilder, access, flowAlias, capability }: ApplyFlowScopeParams<T>): void {
    const condition = flowCapabilityCondition({ access, flowAlias, capability })
    if (!isNil(condition)) {
        queryBuilder.andWhere(condition.sql, condition.params)
    }
}

function applyRunScope<T extends ObjectLiteral>({ queryBuilder, access, runAlias, projectId, scope }: ApplyRunScopeParams<T>): void {
    if (access.unrestricted) {
        return
    }
    const roles = RUN_SCOPE_ROLES[scope]
    const allScope = scopeFor({ access, roles: roles.all })
    if (allScope.projectWide) {
        return
    }
    const ownScope = scopeFor({ access, roles: roles.own })
    const allCondition = flowScopeCondition({ scope: allScope, flowIdColumn: `${runAlias}."flowId"`, flowTable: 'flow', projectId, prefix: 'runAll' })
    const ownFlowCondition = flowScopeCondition({ scope: ownScope, flowIdColumn: `${runAlias}."flowId"`, flowTable: 'flow', projectId, prefix: 'runOwn' })
    const ownUserSql = `${runAlias}."triggeredBy" = :runOwnUserId`
    const ownCondition: Condition | null = isNil(access.userId)
        ? null
        : ownScope.projectWide
            ? { sql: ownUserSql, params: { runOwnUserId: access.userId } }
            : isNil(ownFlowCondition)
                ? null
                : { sql: `(${ownFlowCondition.sql} AND ${ownUserSql})`, params: { ...ownFlowCondition.params, runOwnUserId: access.userId } }
    const clauses = [allCondition, ownCondition].filter((condition): condition is Condition => !isNil(condition))
    queryBuilder.andWhere(buildBrackets({ clauses }))
}

function applyFolderScope<T extends ObjectLiteral>({ queryBuilder, access, folderAlias, projectId }: ApplyFolderScopeParams<T>): void {
    if (access.unrestricted) {
        return
    }
    const projectWide = access.grants.some(isProjectScope)
    if (projectWide) {
        return
    }
    const folderIds = unique(access.grants.filter((grant) => isNil(grant.flowId)).map((grant) => grant.folderId).filter((id): id is string => !isNil(id)))
    const flowIds = unique(access.grants.map((grant) => grant.flowId).filter((id): id is string => !isNil(id)))
    const clauses = [
        ...(folderIds.length > 0 ? [{ sql: `${folderAlias}."id" IN (:...visibleFolderIds)`, params: { visibleFolderIds: folderIds } }] : []),
        ...(flowIds.length > 0
            ? [{
                sql: `${folderAlias}."id" IN (SELECT "vf"."folderId" FROM "flow" "vf" WHERE "vf"."projectId" = :visibleProjectId AND "vf"."id" IN (:...visibleFlowIds))`,
                params: { visibleFlowIds: flowIds, visibleProjectId: projectId },
            }]
            : []),
    ]
    queryBuilder.andWhere(buildBrackets({ clauses }))
}

function buildBrackets({ clauses }: { clauses: Condition[] }): Brackets {
    if (clauses.length === 0) {
        return new Brackets((qb) => {
            qb.where('1 = 0')
        })
    }
    return new Brackets((qb) => {
        clauses.forEach((clause, index) => {
            if (index === 0) {
                qb.where(clause.sql, clause.params)
            }
            else {
                qb.orWhere(clause.sql, clause.params)
            }
        })
    })
}

function assertCan({ allowed, userId, projectId, permission }: AssertCanParams): void {
    if (allowed) {
        return
    }
    throw new ActivepiecesError({
        code: ErrorCode.PERMISSION_DENIED,
        params: {
            userId: userId ?? '',
            projectId,
            projectRole: null,
            permission,
        },
    })
}

export const accessPolicy = {
    isProjectScope,
    scopeOf,
    permissionsForGrants,
    projectScopePermissions,
    rolesOnProject,
    rolesOnFolder,
    rolesOnFlow,
    hasCapability,
    canOnFlow,
    permissionsOnFlow,
    permissionsOnFolder,
    canOnProject,
    canOnFolder,
    canCreateFlow,
    canReadRun,
    canManageAccess,
    canManageAccessAnywhere,
    applyFlowScope,
    flowCapabilityCondition,
    applyRunScope,
    applyFolderScope,
    assertCan,
}

export type Capability = 'SEE' | 'EDIT' | 'EXECUTE' | 'READ_RUNS'

export type RunScope = 'READ' | 'RETRY' | 'MANAGE'

export type ResolvedGrant = {
    role: AccessRole
    folderId: string | null
    flowId: string | null
}

export type ProjectAccess = {
    userId: string | null
    unrestricted: boolean
    permissions: Permission[]
    grants: ResolvedGrant[]
}

export type FlowRef = {
    id: string
    folderId: string | null
}

type CanOnFlowParams = {
    access: ProjectAccess
    flow: FlowRef
    capability: Capability
}

type CanReadRunParams = {
    access: ProjectAccess
    flow: FlowRef
    triggeredBy: string | null | undefined
    scope: RunScope
}

type ManageTarget = {
    folderId?: string | null
    flow?: FlowRef | null
}

type GrantScopeSet = {
    projectWide: boolean
    flowIds: string[]
    folderIds: string[]
}

type Condition = {
    sql: string
    params: Record<string, unknown>
}

type FlowScopeConditionParams = {
    scope: GrantScopeSet
    flowIdColumn: string
    flowTable: string
    projectId: string
    prefix: string
}

type ApplyFlowScopeParams<T extends ObjectLiteral> = {
    queryBuilder: SelectQueryBuilder<T>
    access: ProjectAccess
    flowAlias: string
    capability: Capability
}

type ApplyRunScopeParams<T extends ObjectLiteral> = {
    queryBuilder: SelectQueryBuilder<T>
    access: ProjectAccess
    runAlias: string
    projectId: string
    scope: RunScope
}

type ApplyFolderScopeParams<T extends ObjectLiteral> = {
    queryBuilder: SelectQueryBuilder<T>
    access: ProjectAccess
    folderAlias: string
    projectId: string
}

type AssertCanParams = {
    allowed: boolean
    userId: string | null
    projectId: string
    permission: Permission | undefined
}
