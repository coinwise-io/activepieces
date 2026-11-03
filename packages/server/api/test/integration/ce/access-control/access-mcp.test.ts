import { apId } from '@activepieces/core-utils'
import { AccessPrincipalType, AccessRole, FlowStatus, FlowTriggerType, FlowVersionState, MCP_TRIGGER_PIECE_NAME, PropertyExecutionType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { afterEach, vi } from 'vitest'
import { webhookRunOwner } from '../../../../src/app/webhooks/webhook-run-owner'
import { webhookService } from '../../../../src/app/webhooks/webhook.service'
import { accessTestUtils } from '../../../helpers/access-control'
import { db } from '../../../helpers/db'
import { McpClient, mcpClientHelpers } from '../../../helpers/mcp-client'
import { createMockFlow, createMockFlowVersion, createMockProject } from '../../../helpers/mocks'
import { TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function seedMcpFlow({ admin, toolName }: { admin: TestContext, toolName: string }): Promise<{ id: string, folderId: string | null }> {
    const flow = createMockFlow({ projectId: admin.project.id, status: FlowStatus.ENABLED })
    const version = createMockFlowVersion({
        flowId: flow.id,
        updatedBy: admin.user.id,
        state: FlowVersionState.LOCKED,
        valid: true,
        displayName: toolName,
        trigger: {
            type: FlowTriggerType.PIECE,
            name: 'trigger',
            displayName: 'MCP',
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {
                pieceName: MCP_TRIGGER_PIECE_NAME,
                pieceVersion: '0.0.1',
                triggerName: 'mcp_tool',
                input: { toolName, toolDescription: `runs ${toolName}`, inputSchema: [], returnsResponse: false },
                propertySettings: { input: { type: PropertyExecutionType.MANUAL } },
            },
        },
    })
    await db.save('flow', flow)
    await db.save('flow_version', version)
    await db.update('flow', flow.id, { publishedVersionId: version.id })
    return { id: flow.id, folderId: null }
}

async function connect({ user, admin }: { user: TestContext, admin: TestContext }): Promise<McpClient> {
    return mcpClientHelpers.connect({
        app,
        projectId: admin.project.id,
        approve: (payload) => user.post('/v1/mcp-oauth/approve', payload),
    })
}

async function connectPlatform({ user }: { user: TestContext }): Promise<McpClient> {
    return mcpClientHelpers.connect({
        app,
        approve: (payload) => user.post('/v1/mcp-oauth/approve', payload),
    })
}

function toolNamesStartingWith({ names, prefix }: { names: string[], prefix: string }): string[] {
    return names.filter((name) => name.startsWith(prefix))
}

const DENIED = 'Permission denied'

describe('MCP access control', () => {
    it('exposes and runs only the flows an executor may run, and records who ran it', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const allowed = await seedMcpFlow({ admin, toolName: 'allowedtool' })
        await seedMcpFlow({ admin, toolName: 'forbiddentool' })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: allowed.id })
        const handle = vi.spyOn(webhookService, 'handleWebhook').mockResolvedValue({ status: 200, body: {}, headers: {} })
        const client = await connect({ user: memberOne, admin })

        const names = await mcpClientHelpers.listToolNames({ app, mcpClient: client })
        const toolName = toolNamesStartingWith({ names, prefix: 'allowedtool' })[0]
        const result = await mcpClientHelpers.callTool({ app, mcpClient: client, name: toolName })
        const tables = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_tables' })
        const connections = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_connections' })
        const createFlow = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_create_flow', args: { flowName: 'x' } })

        expect(toolNamesStartingWith({ names, prefix: 'allowedtool' })).toHaveLength(1)
        expect(toolNamesStartingWith({ names, prefix: 'forbiddentool' })).toEqual([])
        expect(result).toContain('Successfully executed')
        expect(handle).toHaveBeenCalledTimes(1)
        expect(handle.mock.calls[0][0].flowId).toBe(allowed.id)
        expect(handle.mock.calls[0][0].triggeredBy).toBe(memberOne.user.id)
        expect(tables).toContain(DENIED)
        expect(connections).toContain(DENIED)
        expect(createFlow).toContain(DENIED)
    })

    it('gives a project editor reached through a group the project tools', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.EDITOR })
        await seedMcpFlow({ admin, toolName: 'edittool' })
        const client = await connect({ user: memberOne, admin })

        const tables = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_tables' })
        const connections = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_connections' })
        const names = await mcpClientHelpers.listToolNames({ app, mcpClient: client })

        expect(tables).not.toContain(DENIED)
        expect(connections).not.toContain(DENIED)
        expect(toolNamesStartingWith({ names, prefix: 'edittool' })).toHaveLength(1)
    })

    it('keeps a narrow editor out of project-wide tools and shows an executor only their own runs', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EXECUTOR })
        const own = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: memberTwo.user.id })
        const others = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: admin.user.id })
        const narrow = await connect({ user: memberOne, admin })
        const executor = await connect({ user: memberTwo, admin })

        const narrowTables = await mcpClientHelpers.callTool({ app, mcpClient: narrow, name: 'ap_list_tables' })
        const narrowOptions = await mcpClientHelpers.callTool({ app, mcpClient: narrow, name: 'ap_list_connections' })
        const runs = await mcpClientHelpers.callTool({ app, mcpClient: executor, name: 'ap_list_runs' })
        const ownRun = await mcpClientHelpers.callTool({ app, mcpClient: executor, name: 'ap_get_run', args: { flowRunId: own } })
        const otherRun = await mcpClientHelpers.callTool({ app, mcpClient: executor, name: 'ap_get_run', args: { flowRunId: others } })

        expect(narrowTables).toContain(DENIED)
        expect(narrowOptions).toContain(DENIED)
        expect(runs).toContain(own)
        expect(runs).not.toContain(others)
        expect(ownRun).toContain(own)
        expect(otherRun).not.toContain(others)
        expect(otherRun.toLowerCase()).toMatch(/denied|not found|permission/)
    })

    it('leaves platform admins unrestricted', async () => {
        const { admin } = await accessTestUtils.setup(app)
        await seedMcpFlow({ admin, toolName: 'admintoolone' })
        await seedMcpFlow({ admin, toolName: 'admintooltwo' })
        const client = await connect({ user: admin, admin })

        const names = await mcpClientHelpers.listToolNames({ app, mcpClient: client })
        const tables = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_tables' })

        expect(toolNamesStartingWith({ names, prefix: 'admintool' })).toHaveLength(2)
        expect(tables).not.toContain(DENIED)
    })

    it('hides projects without a grant from platform project selection', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const granted = createMockProject({ platformId: admin.platform.id, ownerId: admin.user.id, displayName: `granted-${apId()}` })
        const hidden = createMockProject({ platformId: admin.platform.id, ownerId: admin.user.id, displayName: `hidden-${apId()}` })
        await db.save('project', granted)
        await db.save('project', hidden)
        await accessTestUtils.grant({ ctx: { ...admin, project: granted }, principalType: AccessPrincipalType.USER, principalId: memberOne.user.id, role: AccessRole.HISTORY_READER })
        const client = await connectPlatform({ user: memberOne })

        const selectHidden = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_set_project_context', args: { projectId: hidden.id } })
        const selectGranted = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_set_project_context', args: { projectId: granted.id } })
        const lists = await mcpClientHelpers.callTool({ app, mcpClient: client, name: 'ap_list_tables' })

        expect(selectHidden).toContain('don\'t have access')
        expect(selectGranted).toContain('Project context set')
        expect(lists).toContain(DENIED)
    })
})

describe('Webhook run owner', () => {
    it('remembers who started an async run until the worker creates it', async () => {
        const requestId = apId()

        await webhookRunOwner.remember({ requestId, userId: 'user-1' })

        expect(await webhookRunOwner.recall({ requestId })).toBe('user-1')
        expect(await webhookRunOwner.recall({ requestId: apId() })).toBeUndefined()
        expect(await webhookRunOwner.recall({ requestId: undefined })).toBeUndefined()
    })
})
