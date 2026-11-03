import { isNil, Permission, tryCatch } from '@activepieces/core-utils'
import { McpToolDefinition, McpToolResult } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { accessPolicy } from '../access-control/access-policy'
import { projectAccess } from '../project/project-access'

export async function resolvePermissionChecker(params: ResolveCheckerParams): Promise<PermissionChecker> {
    return buildChecker(params)
}

export async function resolveMcpPermissionChecker(params: ResolveCheckerParams): Promise<PermissionChecker> {
    return buildChecker(params)
}

export function deny(text: string): McpToolResult {
    return { content: [{ type: 'text', text }], isError: true }
}

async function buildChecker({ userId, projectId, log }: ResolveCheckerParams): Promise<PermissionChecker> {
    const { data: access } = await tryCatch(() => projectAccess(log).resolveForUser({ userId, projectId }))
    if (isNil(access)) {
        return checkerFor({ allowed: new Set<Permission>() })
    }
    if (access.unrestricted) {
        return ALLOW_ALL
    }
    return checkerFor({ allowed: new Set(accessPolicy.projectScopePermissions({ access })) })
}

function checkerFor({ allowed }: { allowed: Set<Permission> }): PermissionChecker {
    const check: PermissionChecker['check'] = (permission, toolTitle) => {
        const required = requiredPermissionOf({ permission, toolTitle })
        if (isNil(required) || allowed.has(required)) {
            return null
        }
        return deny(`❌ Permission denied: your access to this project does not include "${required}". Cannot execute "${toolTitle}".`)
    }
    return {
        check,
        wrapExecute: ({ execute, permission, toolTitle }) => async (args) => check(permission, toolTitle) ?? execute(args),
    }
}

function requiredPermissionOf({ permission, toolTitle }: { permission: Permission | undefined, toolTitle: string }): Permission | undefined {
    if (!isNil(permission)) {
        return permission
    }
    return BUILDER_ONLY_TOOLS.includes(toolTitle) ? Permission.WRITE_FLOW : undefined
}

const BUILDER_ONLY_TOOLS: string[] = [
    'ap_resolve_property_options',
    'ap_resolve_property_chain',
    'ap_list_ai_models',
    'ap_validate_step_config',
]

export const ALLOW_ALL: PermissionChecker = {
    check: () => null,
    wrapExecute: ({ execute }) => execute,
}

export const READ_ONLY_CHECKER: PermissionChecker = {
    check: (permission, toolTitle) => {
        const readOnly = isNil(permission) ? !BUILDER_ONLY_TOOLS.includes(toolTitle) : permission.startsWith('READ_')
        return readOnly ? null : deny(`❌ Permission denied: this connection is not tied to a user, so "${toolTitle}" is not allowed.`)
    },
    wrapExecute: ({ execute, permission, toolTitle }) => async (args) => READ_ONLY_CHECKER.check(permission, toolTitle) ?? execute(args),
}

export type PermissionChecker = {
    check: (permission: Permission | undefined, toolTitle: string) => McpToolResult | null
    wrapExecute: (params: { execute: McpToolDefinition['execute'], permission: Permission | undefined, toolTitle: string }) => McpToolDefinition['execute']
}

type ResolveCheckerParams = {
    userId: string
    projectId: string
    log: FastifyBaseLogger
}
