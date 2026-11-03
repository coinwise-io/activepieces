import { apId } from '@activepieces/core-utils'
import { cryptoUtils } from '@activepieces/server-utils'
import { AccessPrincipalType, AccessRole, FileCompression, FileType, FlowStatus, FlowTriggerType, FlowVersionState, PLACEHOLDER_CONNECTION_TYPE, UserStatus, WebsocketClientEvent, WebsocketServerEvent } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterEach, vi } from 'vitest'
import { accessResolver } from '../../../../src/app/access-control/access-resolver'
import { websocketService } from '../../../../src/app/core/websockets.service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { fileService } from '../../../../src/app/file/file.service'
import { mcpOAuthTokenService } from '../../../../src/app/mcp/oauth/token/mcp-oauth-token.service'
import { userService } from '../../../../src/app/user/user-service'
import { accessTestUtils } from '../../../helpers/access-control'
import { db } from '../../../helpers/db'
import { fakeSocket } from '../../../helpers/fake-socket'
import { mcpClientHelpers } from '../../../helpers/mcp-client'
import { createMockFlowVersion } from '../../../helpers/mocks'
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

const MANUAL_TRIGGER = {
    type: FlowTriggerType.PIECE,
    name: 'trigger',
    displayName: 'Manual',
    valid: true,
    lastUpdatedDate: new Date().toISOString(),
    settings: {
        pieceName: '@activepieces/piece-manual-trigger',
        pieceVersion: '0.0.1',
        triggerName: 'manual_trigger',
        input: {},
        propertySettings: {},
    },
}

async function seedPublishedManualFlow({ admin }: { admin: TestContext }): Promise<{ flowId: string, publishedVersionId: string, draftVersionId: string }> {
    const flow = await accessTestUtils.createFlow({ ctx: admin })
    await db.update('flow_version', flow.version.id, { trigger: MANUAL_TRIGGER, state: FlowVersionState.LOCKED, valid: true })
    await db.update('flow', flow.id, { publishedVersionId: flow.version.id, status: FlowStatus.ENABLED })
    const draft = createMockFlowVersion({
        flowId: flow.id,
        state: FlowVersionState.DRAFT,
        trigger: MANUAL_TRIGGER,
        valid: true,
        created: new Date(Date.now() + 60_000).toISOString(),
    })
    await db.save('flow_version', draft)
    return { flowId: flow.id, publishedVersionId: flow.version.id, draftVersionId: draft.id }
}

async function connectMcp({ user, admin }: { user: TestContext, admin: TestContext }): ReturnType<typeof mcpClientHelpers.connect> {
    return mcpClientHelpers.connect({
        app,
        projectId: admin.project.id,
        approve: (payload) => user.post('/v1/mcp-oauth/approve', payload),
    })
}

async function mcpStatus({ accessToken }: { accessToken: string }): Promise<number> {
    const response = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
            'authorization': `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })
    return response.statusCode
}

async function saveMcpToken({ userId, platformId, projectId }: { userId: string, platformId: string, projectId: string }): Promise<{ id: string, refreshToken: string, clientId: string }> {
    const refreshToken = apId()
    const clientId = apId()
    const id = apId()
    await databaseConnection().query(
        'INSERT INTO "mcp_oauth_token" ("id", "refreshToken", "clientId", "userId", "projectId", "platformId", "scopes", "expiresAt", "revoked") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)',
        [id, cryptoUtils.hashSHA256(refreshToken), clientId, userId, projectId, platformId, ['mcp'], new Date(Date.now() + 3_600_000).toISOString()],
    )
    return { id, refreshToken, clientId }
}

describe('Deactivated and removed users lose access', () => {
    it('resolves no access for an inactive user, a removed user and a removed project owner', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const project = { ...admin.project, ownerId: memberOne.user.id }
        const active = await userService(app.log).getOneOrFail({ id: memberOne.user.id })

        const whileActive = await accessResolver.resolve({ user: active, project })
        await db.update('user', memberOne.user.id, { status: UserStatus.INACTIVE })
        const inactive = await userService(app.log).getOneOrFail({ id: memberOne.user.id })
        const whileInactive = await accessResolver.resolve({ user: inactive, project })
        await db.update('user', memberOne.user.id, { status: UserStatus.ACTIVE, platformId: null })
        const removed = await userService(app.log).getOneOrFail({ id: memberOne.user.id })
        const whileRemoved = await accessResolver.resolve({ user: removed, project })

        expect(whileActive?.unrestricted).toBe(true)
        expect(whileInactive).toBeNull()
        expect(whileRemoved).toBeNull()
    })

    it('rejects an MCP access token once the user is deactivated, even before the grant is revoked', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const client = await connectMcp({ user: memberOne, admin })
        const before = await mcpStatus({ accessToken: client.accessToken })

        await db.update('user', memberOne.user.id, { status: UserStatus.INACTIVE })
        const after = await mcpStatus({ accessToken: client.accessToken })

        expect(before).toBe(StatusCodes.OK)
        expect(after).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects an MCP access token and a refresh token for a user who left the platform', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const token = await saveMcpToken({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        const accessToken = await mcpOAuthTokenService.issueInternalAccessToken({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        const before = await mcpOAuthTokenService.authenticate({ token: accessToken, log: app.log })

        await db.update('user', memberOne.user.id, { platformId: null })
        const after = await mcpOAuthTokenService.authenticate({ token: accessToken, log: app.log })
        const refresh = await mcpOAuthTokenService.refreshAccessToken({ refreshToken: token.refreshToken, clientId: token.clientId, redirectUris: [] }).catch((error: Error) => error)

        expect(before.status).toBe('ok')
        expect(after.status).toBe('invalid')
        expect(refresh).toBeInstanceOf(Error)
    })

    it('revokes MCP grants when a user is deactivated through the user service', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const token = await saveMcpToken({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })

        await userService(app.log).update({ id: memberOne.user.id, platformId: admin.platform.id, status: UserStatus.INACTIVE })

        const row = await db.findOneByOrFail<{ revoked: boolean }>('mcp_oauth_token', { id: token.id })
        expect(row.revoked).toBe(true)
    })

    it('revokes MCP grants, access grants and group membership when a user is removed from the platform', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const token = await saveMcpToken({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })

        await userService(app.log).removeFromPlatform({ id: memberOne.user.id, platformId: admin.platform.id })

        const tokenRow = await db.findOneByOrFail<{ revoked: boolean }>('mcp_oauth_token', { id: token.id })
        const grants = await db.findBy('access_grant', { userId: memberOne.user.id })
        const memberships = await db.findBy('user_group_member', { userId: memberOne.user.id, groupId: group.id })
        expect(tokenRow.revoked).toBe(true)
        expect(grants).toHaveLength(0)
        expect(memberships).toHaveLength(0)
    })

    it('revokes MCP grants when a user is deleted', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const accessToken = await mcpOAuthTokenService.issueInternalAccessToken({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        const before = await mcpOAuthTokenService.authenticate({ token: accessToken, log: app.log })

        await userService(app.log).delete({ id: memberOne.user.id, platformId: admin.platform.id })
        const after = await mcpOAuthTokenService.authenticate({ token: accessToken, log: app.log })

        expect(before.status).toBe('ok')
        expect(after.status).toBe('invalid')
    })
})

describe('Manual trigger runs for non-editors', () => {
    it('lets an executor run only the published version of an enabled manual flow', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const seeded = await seedPublishedManualFlow({ admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: seeded.flowId })
        const tab = await fakeSocket.open({ app, userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })

        tab.fire({ event: WebsocketServerEvent.MANUAL_TRIGGER_RUN_STARTED, data: { flowVersionId: seeded.draftVersionId } })
        await new Promise((resolve) => setTimeout(resolve, 700))
        const draftRuns = await db.findBy('flow_run', { flowId: seeded.flowId })
        tab.fire({ event: WebsocketServerEvent.MANUAL_TRIGGER_RUN_STARTED, data: { flowVersionId: seeded.publishedVersionId } })
        const started = await fakeSocket.waitFor({
            condition: () => tab.emitted.some((entry) => entry.event === WebsocketClientEvent.MANUAL_TRIGGER_RUN_STARTED),
            timeoutMs: 5000,
        })

        expect(draftRuns).toHaveLength(0)
        expect(started).toBe(true)
    })

    it('refuses an executor when the flow is disabled, and lets an editor run a draft', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const seeded = await seedPublishedManualFlow({ admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: seeded.flowId })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR, flowId: seeded.flowId })
        await db.update('flow', seeded.flowId, { status: FlowStatus.DISABLED })
        const executorTab = await fakeSocket.open({ app, userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        const editorTab = await fakeSocket.open({ app, userId: memberTwo.user.id, platformId: admin.platform.id, projectId: admin.project.id })

        executorTab.fire({ event: WebsocketServerEvent.MANUAL_TRIGGER_RUN_STARTED, data: { flowVersionId: seeded.publishedVersionId } })
        await new Promise((resolve) => setTimeout(resolve, 700))
        editorTab.fire({ event: WebsocketServerEvent.MANUAL_TRIGGER_RUN_STARTED, data: { flowVersionId: seeded.draftVersionId } })
        const editorStarted = await fakeSocket.waitFor({
            condition: () => editorTab.emitted.some((entry) => entry.event === WebsocketClientEvent.MANUAL_TRIGGER_RUN_STARTED),
            timeoutMs: 5000,
        })

        expect(executorTab.emitted).toHaveLength(0)
        expect(editorStarted).toBe(true)
    })
})

describe('Sample data is tied to its flow', () => {
    it('does not return another flow sample data file referenced from a flow step', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const own = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: own.id })
        const save = async ({ flowId, flowVersionId, content }: { flowId: string, flowVersionId: string, content: string }): Promise<string> => {
            const file = await fileService(app.log).save({
                projectId: admin.project.id,
                data: Buffer.from(JSON.stringify(content)),
                size: JSON.stringify(content).length,
                type: FileType.SAMPLE_DATA,
                compression: FileCompression.NONE,
                metadata: { flowId, flowVersionId, stepName: 'trigger' },
            })
            return file.id
        }
        const otherFileId = await save({ flowId: other.id, flowVersionId: other.version.id, content: 'top-secret-of-other-flow' })
        const ownFileId = await save({ flowId: own.id, flowVersionId: own.version.id, content: 'my-own-sample' })
        const query = { projectId: admin.project.id, flowId: own.id, flowVersionId: own.version.id, stepName: 'trigger', type: 'OUTPUT' }

        await db.update('flow_version', own.version.id, { trigger: { ...MANUAL_TRIGGER, settings: { ...MANUAL_TRIGGER.settings, sampleData: { sampleDataFileId: ownFileId } } } })
        const mine = await memberOne.get('/v1/sample-data', query)
        await db.update('flow_version', own.version.id, { trigger: { ...MANUAL_TRIGGER, settings: { ...MANUAL_TRIGGER.settings, sampleData: { sampleDataFileId: otherFileId } } } })
        const stolen = await memberOne.get('/v1/sample-data', query)

        expect(mine.body).toContain('my-own-sample')
        expect(stolen.body).not.toContain('top-secret-of-other-flow')
    })
})

describe('Connection and variable squatting', () => {
    it('refuses a narrow editor re-creating a connection id that a flow they cannot edit references', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const own = await accessTestUtils.createFlow({ ctx: admin })
        const hidden = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: own.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR })
        const externalId = `ext-${apId()}`
        await db.update('flow_version', hidden.version.id, { connectionIds: [externalId] })
        const body = (id: string): Record<string, unknown> => ({
            projectId: admin.project.id,
            externalId: id,
            displayName: 'conn',
            pieceName: '@activepieces/piece-slack',
            pieceVersion: '0.0.1',
            type: PLACEHOLDER_CONNECTION_TYPE,
        })

        const squat = await memberOne.post('/v1/app-connections', body(externalId))
        const fresh = await memberOne.post('/v1/app-connections', body(`ext-${apId()}`))
        const projectEditor = await memberTwo.post('/v1/app-connections', body(externalId))

        expect(squat.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(fresh.statusCode).toBe(StatusCodes.CREATED)
        expect(projectEditor.statusCode).toBe(StatusCodes.CREATED)
    })

    it('lets a narrow editor reuse a connection id referenced only by flows they can edit', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const own = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: own.id })
        const externalId = `ext-${apId()}`
        await db.update('flow_version', own.version.id, { connectionIds: [externalId] })

        const response = await memberOne.post('/v1/app-connections', {
            projectId: admin.project.id,
            externalId,
            displayName: 'conn',
            pieceName: '@activepieces/piece-slack',
            pieceVersion: '0.0.1',
            type: PLACEHOLDER_CONNECTION_TYPE,
        })

        expect(response.statusCode).toBe(StatusCodes.CREATED)
    })

    it('refuses a narrow editor creating a variable that a flow they cannot edit references', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const own = await accessTestUtils.createFlow({ ctx: admin })
        const hidden = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: own.id })
        const name = `V${apId().replace(/[^a-zA-Z0-9]/g, '')}`
        await db.update('flow_version', hidden.version.id, {
            trigger: { ...MANUAL_TRIGGER, settings: { ...MANUAL_TRIGGER.settings, input: { token: `{{variables['${name}']}}` } } },
        })

        const squat = await memberOne.post('/v1/variables', { projectId: admin.project.id, name, value: 'x' })
        const fresh = await memberOne.post('/v1/variables', { projectId: admin.project.id, name: `W${apId().replace(/[^a-zA-Z0-9]/g, '')}`, value: 'x' })
        const asAdmin = await admin.post('/v1/variables', { projectId: admin.project.id, name, value: 'x' })

        expect(squat.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(fresh.statusCode).toBe(StatusCodes.CREATED)
        expect(asAdmin.statusCode).toBe(StatusCodes.CREATED)
    })
})

describe('Websocket rooms follow indirect grant changes', () => {
    it('refreshes socket access when a folder is deleted, a flow is moved or a flow is deleted', async () => {
        const { admin } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const refresh = vi.spyOn(websocketService, 'refreshAccessForProject').mockResolvedValue(undefined)

        const move = await admin.post(`/v1/flows/${flow.id}`, { type: 'CHANGE_FOLDER', request: { folderId: folder.id } })
        const movedCalls = refresh.mock.calls.length
        const removeFolder = await admin.delete(`/v1/folders/${folder.id}`)
        const folderCalls = refresh.mock.calls.length
        const removeFlow = await admin.delete(`/v1/flows/${flow.id}`)

        expect(move.statusCode).toBe(StatusCodes.OK)
        expect(removeFolder.statusCode).toBe(StatusCodes.OK)
        expect(removeFlow.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect(movedCalls).toBeGreaterThanOrEqual(1)
        expect(folderCalls).toBeGreaterThan(movedCalls)
        expect(refresh.mock.calls.length).toBeGreaterThan(folderCalls)
        expect(refresh.mock.calls.every(([params]) => params.projectId === admin.project.id)).toBe(true)
    })
})

describe('Self grants', () => {
    it('stops a narrow editor granting access to themselves or to a group they belong to', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        const ownGroup = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        const otherGroup = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberTwo.user.id] })
        const request = (principalType: AccessPrincipalType, principalId: string): Record<string, unknown> => ({
            projectId: admin.project.id,
            principalType,
            principalId,
            role: AccessRole.EXECUTOR,
            flowId: flow.id,
        })

        const toSelf = await memberOne.post('/v1/access-grants', request(AccessPrincipalType.USER, memberOne.user.id))
        const toOwnGroup = await memberOne.post('/v1/access-grants', request(AccessPrincipalType.GROUP, ownGroup.id))
        const toOther = await memberOne.post('/v1/access-grants', request(AccessPrincipalType.USER, memberTwo.user.id))
        const toOtherGroup = await memberOne.post('/v1/access-grants', request(AccessPrincipalType.GROUP, otherGroup.id))

        expect(toSelf.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(toOwnGroup.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(toOther.statusCode).toBe(StatusCodes.CREATED)
        expect(toOtherGroup.statusCode).toBe(StatusCodes.CREATED)
    })

    it('lets a project editor and an admin grant to themselves', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })

        const projectEditor = await memberOne.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberOne.user.id,
            role: AccessRole.HISTORY_READER,
        })

        expect(projectEditor.statusCode).toBe(StatusCodes.CREATED)
    })
})

describe('Principal search', () => {
    it('matches only an exact email or group name for narrow editors, and keeps substring search for project editors', async () => {
        const { admin, memberOne, memberTwo, memberThree } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberThree, role: AccessRole.EDITOR })
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, displayName: `Finance-${apId()}`, memberIds: [] })
        const email = memberTwo.userIdentity.email
        const search = (ctx: TestContext, term: string) => ctx.get('/v1/access-grants/principals', { projectId: admin.project.id, search: term })

        const exactEmail = await search(memberOne, email.toUpperCase())
        const partialEmail = await search(memberOne, email.slice(0, 8))
        const exactGroup = await search(memberOne, group.displayName)
        const partialGroup = await search(memberOne, group.displayName.slice(0, 7))
        const broadEmail = await search(memberThree, email.slice(0, 8))
        const broadAdmin = await search(admin, group.displayName.slice(0, 7))

        expect(exactEmail.json().data.map((entry: { id: string }) => entry.id)).toEqual([memberTwo.user.id])
        expect(partialEmail.json().data).toEqual([])
        expect(exactGroup.json().data.map((entry: { id: string }) => entry.id)).toEqual([group.id])
        expect(partialGroup.json().data).toEqual([])
        expect(broadEmail.json().data.map((entry: { id: string }) => entry.id)).toContain(memberTwo.user.id)
        expect(broadAdmin.json().data.map((entry: { id: string }) => entry.id)).toContain(group.id)
    })
})

describe('Folder table counts', () => {
    it('counts tables only for callers who can read tables', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const flow = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR })
        const table = await admin.post('/v1/tables', { name: `t${apId().replace(/[^a-zA-Z0-9]/g, '')}`, projectId: admin.project.id, folderId: folder.id })
        expect(table.statusCode).toBe(StatusCodes.OK)

        const asAdmin = await admin.get('/v1/folders', { projectId: admin.project.id, limit: 100 })
        const asProjectEditor = await memberTwo.get(`/v1/folders/${folder.id}`)
        const asNarrowList = await memberOne.get('/v1/folders', { projectId: admin.project.id, limit: 100 })
        const asNarrowSingle = await memberOne.get(`/v1/folders/${folder.id}`)

        expect(asAdmin.json().data[0].numberOfTables).toBe(1)
        expect(asProjectEditor.json().numberOfTables).toBe(1)
        expect(asNarrowList.json().data[0].numberOfTables).toBe(0)
        expect(asNarrowSingle.json().numberOfTables).toBe(0)
    })
})
