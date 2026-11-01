import { Permission } from '@activepieces/core-utils'
import { McpToolDefinition, McpToolResult } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'

export async function resolvePermissionChecker(_params: ResolveCheckerParams): Promise<PermissionChecker> {
    return ALLOW_ALL
}

export async function resolveMcpPermissionChecker(_params: ResolveCheckerParams): Promise<PermissionChecker> {
    return ALLOW_ALL
}

export const ALLOW_ALL: PermissionChecker = {
    check: () => null,
    wrapExecute: ({ execute }) => execute,
}

export function deny(text: string): McpToolResult {
    return { content: [{ type: 'text', text }], isError: true }
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
