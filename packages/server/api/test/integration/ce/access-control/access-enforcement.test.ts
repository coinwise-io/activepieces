import { apId } from '@activepieces/core-utils'
import { AccessPrincipalType, AccessRole, FlowOperationType, PlatformRole, PrincipalType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { accessTestUtils } from '../../../helpers/access-control'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { mockBasicUser } from '../../../helpers/mocks'
import { createMemberContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function listFlows({ member, projectId, query }: { member: TestContext, projectId: string, query?: Record<string, unknown> }) {
    return member.get('/v1/flows', { projectId, limit: 100, ...query })
}

async function flowIdsOf({ member, projectId }: { member: TestContext, projectId: string }): Promise<string[]> {
    const response = await listFlows({ member, projectId })
    expect(response.statusCode).toBe(StatusCodes.OK)
    return response.json().data.map((flow: { id: string }) => flow.id).sort()
}

async function runIdsOf({ member, projectId, flowId }: { member: TestContext, projectId: string, flowId?: string }): Promise<string[]> {
    const response = await member.get('/v1/flow-runs', { projectId, limit: 100, ...(flowId ? { flowId: [flowId] } : {}) })
    expect(response.statusCode).toBe(StatusCodes.OK)
    return response.json().data.map((run: { id: string }) => run.id).sort()
}

function rename({ member, flowId, displayName }: { member: TestContext, flowId: string, displayName: string }) {
    return member.post(`/v1/flows/${flowId}`, {
        type: FlowOperationType.CHANGE_NAME,
        request: { displayName },
    })
}

describe('Members without a grant', () => {
    it('cannot see a team project, its flows, folders or runs', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const runId = await accessTestUtils.createRun({ projectId: admin.project.id, flow })

        const flows = await listFlows({ member: memberOne, projectId: admin.project.id })
        const getFlow = await memberOne.get(`/v1/flows/${flow.id}`)
        const folders = await memberOne.get('/v1/folders', { projectId: admin.project.id })
        const runs = await memberOne.get('/v1/flow-runs', { projectId: admin.project.id })
        const run = await memberOne.get(`/v1/flow-runs/${runId}`)
        const created = await memberOne.post('/v1/flows', { displayName: 'x', projectId: admin.project.id })

        for (const response of [flows, getFlow, folders, runs, run, created]) {
            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        }
    })

    it('still work in their personal project', async () => {
        const { memberOne } = await accessTestUtils.setup(app)

        const created = await accessTestUtils.createFlow({ ctx: memberOne })
        const flows = await flowIdsOf({ member: memberOne, projectId: memberOne.project.id })

        expect(flows).toEqual([created.id])
    })
})

describe('Project scope grants', () => {
    it('lets an editor reached through a group list, edit, create flows and create folders', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.EDITOR })
        const flow = await accessTestUtils.createFlow({ ctx: admin })

        const ids = await flowIdsOf({ member: memberOne, projectId: admin.project.id })
        const renamed = await rename({ member: memberOne, flowId: flow.id, displayName: 'Renamed by group editor' })
        const created = await memberOne.post('/v1/flows', { displayName: 'new', projectId: admin.project.id })
        const folder = await memberOne.post('/v1/folders', { displayName: `f-${apId()}`, projectId: admin.project.id })

        expect(ids).toEqual([flow.id])
        expect(renamed.statusCode).toBe(StatusCodes.OK)
        expect(created.statusCode).toBe(StatusCodes.CREATED)
        expect(folder.statusCode).toBe(StatusCodes.OK)
    })

    it('lets a history reader see flows and every run but change nothing', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER })
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const runId = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: admin.user.id })

        const getFlow = await memberOne.get(`/v1/flows/${flow.id}`)
        const runs = await runIdsOf({ member: memberOne, projectId: admin.project.id })
        const run = await memberOne.get(`/v1/flow-runs/${runId}`)
        const renamed = await rename({ member: memberOne, flowId: flow.id, displayName: 'nope' })
        const deleted = await memberOne.delete(`/v1/flows/${flow.id}`)
        const folder = await memberOne.post('/v1/folders', { displayName: 'nope', projectId: admin.project.id })

        expect(getFlow.statusCode).toBe(StatusCodes.OK)
        expect(runs).toEqual([runId])
        expect(run.statusCode).toBe(StatusCodes.OK)
        expect(renamed.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(deleted.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(folder.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('lets a project executor see flows and only the runs they started', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const own = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: memberOne.user.id })
        const others = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: memberTwo.user.id })

        const runs = await runIdsOf({ member: memberOne, projectId: admin.project.id })
        const ownRun = await memberOne.get(`/v1/flow-runs/${own}`)
        const otherRun = await memberOne.get(`/v1/flow-runs/${others}`)
        const renamed = await rename({ member: memberOne, flowId: flow.id, displayName: 'nope' })

        expect(runs).toEqual([own])
        expect(ownRun.statusCode).toBe(StatusCodes.OK)
        expect(otherRun.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(renamed.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('adds up the roles of a user and of their groups', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.HISTORY_READER })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const others = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: admin.user.id })

        const runs = await runIdsOf({ member: memberOne, projectId: admin.project.id })

        expect(runs).toEqual([others])
    })
})

describe('Folder scope grants', () => {
    it('shows an executor only the flows of the folder and only their own runs, read-only', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const otherFolder = await accessTestUtils.createFolder({ ctx: admin })
        const inFolder = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        const alsoInFolder = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        const outside = await accessTestUtils.createFlow({ ctx: admin, folderId: otherFolder.id })
        const uncategorized = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, folderId: folder.id })
        const own = await accessTestUtils.createRun({ projectId: admin.project.id, flow: inFolder, triggeredBy: memberOne.user.id })
        await accessTestUtils.createRun({ projectId: admin.project.id, flow: inFolder, triggeredBy: memberTwo.user.id })
        const ownOutside = await accessTestUtils.createRun({ projectId: admin.project.id, flow: outside, triggeredBy: memberOne.user.id })

        const ids = await flowIdsOf({ member: memberOne, projectId: admin.project.id })
        const count = await memberOne.get('/v1/flows/count', { projectId: admin.project.id })
        const getInside = await memberOne.get(`/v1/flows/${inFolder.id}`)
        const getOutside = await memberOne.get(`/v1/flows/${outside.id}`)
        const getUncategorized = await memberOne.get(`/v1/flows/${uncategorized.id}`)
        const renamed = await rename({ member: memberOne, flowId: inFolder.id, displayName: 'nope' })
        const runs = await runIdsOf({ member: memberOne, projectId: admin.project.id })
        const ownOutsideRun = await memberOne.get(`/v1/flow-runs/${ownOutside}`)
        const versions = await memberOne.get(`/v1/flows/${inFolder.id}/versions`)

        expect(ids).toEqual([inFolder.id, alsoInFolder.id].sort())
        expect(count.json()).toBe(2)
        expect(getInside.statusCode).toBe(StatusCodes.OK)
        expect(getOutside.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(getUncategorized.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(renamed.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(runs).toEqual([own])
        expect(ownOutsideRun.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(versions.statusCode).toBe(StatusCodes.OK)
    })

    it('lists only folders the member can reach', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const granted = await accessTestUtils.createFolder({ ctx: admin })
        const withGrantedFlow = await accessTestUtils.createFolder({ ctx: admin })
        const hidden = await accessTestUtils.createFolder({ ctx: admin })
        const flow = await accessTestUtils.createFlow({ ctx: admin, folderId: withGrantedFlow.id })
        await accessTestUtils.createFlow({ ctx: admin, folderId: hidden.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, folderId: granted.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER, flowId: flow.id })

        const list = await memberOne.get('/v1/folders', { projectId: admin.project.id, limit: 100 })
        const getHidden = await memberOne.get(`/v1/folders/${hidden.id}`)
        const getGranted = await memberOne.get(`/v1/folders/${granted.id}`)

        expect(list.statusCode).toBe(StatusCodes.OK)
        expect(list.json().data.map((folder: { id: string }) => folder.id).sort()).toEqual([granted.id, withGrantedFlow.id].sort())
        expect(getHidden.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(getGranted.statusCode).toBe(StatusCodes.OK)
    })

    it('lets a folder editor create flows in the folder only and move flows inside their reach', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const otherFolder = await accessTestUtils.createFolder({ ctx: admin })
        const inFolder = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        const elsewhere = await accessTestUtils.createFlow({ ctx: admin, folderId: otherFolder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, folderId: folder.id })

        const createdInside = await memberOne.post('/v1/flows', { displayName: 'inside', projectId: admin.project.id, folderId: folder.id })
        const createdOutside = await memberOne.post('/v1/flows', { displayName: 'outside', projectId: admin.project.id })
        const createdElsewhere = await memberOne.post('/v1/flows', { displayName: 'elsewhere', projectId: admin.project.id, folderId: otherFolder.id })
        const renamed = await rename({ member: memberOne, flowId: inFolder.id, displayName: 'renamed' })
        const renamedElsewhere = await rename({ member: memberOne, flowId: elsewhere.id, displayName: 'nope' })
        const moveOut = await memberOne.post(`/v1/flows/${inFolder.id}`, {
            type: FlowOperationType.CHANGE_FOLDER,
            request: { folderId: otherFolder.id },
        })
        const newFolder = await memberOne.post('/v1/folders', { displayName: 'nope', projectId: admin.project.id })
        const renameFolder = await memberOne.post(`/v1/folders/${folder.id}`, { displayName: 'nope' })
        const deleteFolder = await memberOne.delete(`/v1/folders/${folder.id}`)

        expect(createdInside.statusCode).toBe(StatusCodes.CREATED)
        expect(createdOutside.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(createdElsewhere.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(renamed.statusCode).toBe(StatusCodes.OK)
        expect(renamedElsewhere.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(moveOut.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(newFolder.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(renameFolder.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(deleteFolder.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})

describe('Flow scope grants', () => {
    it('shows a history reader every run of the flow and nothing of the other flows', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const audited = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER, flowId: audited.id })
        const first = await accessTestUtils.createRun({ projectId: admin.project.id, flow: audited, triggeredBy: memberTwo.user.id })
        const second = await accessTestUtils.createRun({ projectId: admin.project.id, flow: audited, triggeredBy: admin.user.id })
        const otherRun = await accessTestUtils.createRun({ projectId: admin.project.id, flow: other, triggeredBy: admin.user.id })

        const runs = await runIdsOf({ member: memberOne, projectId: admin.project.id })
        const filteredToOther = await runIdsOf({ member: memberOne, projectId: admin.project.id, flowId: other.id })
        const getOther = await memberOne.get(`/v1/flow-runs/${otherRun}`)
        const flows = await flowIdsOf({ member: memberOne, projectId: admin.project.id })
        const counts = await memberOne.get('/v1/flow-runs/count-by-status', { projectId: admin.project.id })

        expect(runs).toEqual([first, second].sort())
        expect(filteredToOther).toEqual([])
        expect(getOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(flows).toEqual([audited.id])
        expect(counts.json().data.reduce((total: number, row: { count: number }) => total + row.count, 0)).toBe(2)
    })

    it('lets a flow editor change that flow only and not create folders or root flows', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const mine = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: mine.id })

        const renamed = await rename({ member: memberOne, flowId: mine.id, displayName: 'mine renamed' })
        const renamedOther = await rename({ member: memberOne, flowId: other.id, displayName: 'nope' })
        const getOther = await memberOne.get(`/v1/flows/${other.id}`)
        const folder = await memberOne.post('/v1/folders', { displayName: 'nope', projectId: admin.project.id })
        const created = await memberOne.post('/v1/flows', { displayName: 'root', projectId: admin.project.id })
        const deletedOther = await memberOne.delete(`/v1/flows/${other.id}`)
        const connections = await memberOne.get('/v1/app-connections', { projectId: admin.project.id })
        const tables = await memberOne.get('/v1/tables', { projectId: admin.project.id })
        const project = await memberOne.get(`/v1/projects/${admin.project.id}`)

        expect(renamed.statusCode).toBe(StatusCodes.OK)
        expect(renamedOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(getOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(folder.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(created.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(deletedOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(connections.statusCode).toBe(StatusCodes.OK)
        expect(tables.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(project.statusCode).toBe(StatusCodes.OK)
    })

    it('forbids a flow editor from touching other flows through sample data, trigger events and test runs', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const mine = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: mine.id })

        const sampleOther = await memberOne.get('/v1/sample-data', { projectId: admin.project.id, flowId: other.id, flowVersionId: other.version.id, stepName: 'trigger', type: 'OUTPUT' })
        const sampleMine = await memberOne.get('/v1/sample-data', { projectId: admin.project.id, flowId: mine.id, flowVersionId: mine.version.id, stepName: 'trigger', type: 'OUTPUT' })
        const eventsOther = await memberOne.get('/v1/trigger-events', { projectId: admin.project.id, flowId: other.id })
        const testStepOther = await memberOne.post('/v1/sample-data/test-step', { projectId: admin.project.id, flowVersionId: other.version.id, stepName: 'trigger' })
        const testTriggerOther = await memberOne.post('/v1/test-trigger', { projectId: admin.project.id, flowId: other.id, flowVersionId: other.version.id, testStrategy: 'TEST_FUNCTION' })

        expect(sampleOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(sampleMine.statusCode).not.toBe(StatusCodes.FORBIDDEN)
        expect(eventsOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(testStepOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(testTriggerOther.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('forbids retrying runs of flows the caller cannot edit and other people runs', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.HISTORY_READER, flowId: flow.id })
        const others = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: admin.user.id })
        const unrelated = await accessTestUtils.createRun({ projectId: admin.project.id, flow: other, triggeredBy: memberOne.user.id })

        const retryOthers = await memberOne.post(`/v1/flow-runs/${others}/retry`, { projectId: admin.project.id, strategy: 'ON_LATEST_VERSION' })
        const retryUnrelated = await memberOne.post(`/v1/flow-runs/${unrelated}/retry`, { projectId: admin.project.id, strategy: 'ON_LATEST_VERSION' })
        const retryAsReader = await memberTwo.post(`/v1/flow-runs/${others}/retry`, { projectId: admin.project.id, strategy: 'ON_LATEST_VERSION' })
        const cancel = await memberOne.post('/v1/flow-runs/cancel', { projectId: admin.project.id, flowRunIds: [others] })

        expect(retryOthers.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(retryUnrelated.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(retryAsReader.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(cancel.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})

describe('Platform roles', () => {
    it('keeps platform admins and project owners unrestricted', async () => {
        const { admin } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const runId = await accessTestUtils.createRun({ projectId: admin.project.id, flow, triggeredBy: admin.user.id })

        const flows = await flowIdsOf({ member: admin, projectId: admin.project.id })
        const runs = await runIdsOf({ member: admin, projectId: admin.project.id })
        const renamed = await rename({ member: admin, flowId: flow.id, displayName: 'admin rename' })

        expect(flows).toEqual([flow.id])
        expect(runs).toEqual([runId])
        expect(renamed.statusCode).toBe(StatusCodes.OK)
    })

    it('keeps platform operators as editors on every project', async () => {
        const { admin } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const { mockUser } = await mockBasicUser({ user: { platformId: admin.platform.id, platformRole: PlatformRole.OPERATOR } })
        const token = await generateMockToken({ id: mockUser.id, type: PrincipalType.USER, platform: { id: admin.platform.id } })
        const headers = { authorization: `Bearer ${token}` }

        const list = await app.inject({ method: 'GET', url: '/api/v1/flows', headers, query: { projectId: admin.project.id } })
        const renamed = await app.inject({ method: 'POST', url: `/api/v1/flows/${flow.id}`, headers, body: { type: FlowOperationType.CHANGE_NAME, request: { displayName: 'operator rename' } } })

        expect(list.statusCode).toBe(StatusCodes.OK)
        expect(list.json().data).toHaveLength(1)
        expect(renamed.statusCode).toBe(StatusCodes.OK)
    })

    it('does not leak grants across platforms', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const other = await accessTestUtils.setup(app)
        const foreignMember = await createMemberContext(app, other.admin, { projectRole: 'none' })

        const response = await listFlows({ member: foreignMember, projectId: admin.project.id })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(await db.findBy('access_grant', { projectId: admin.project.id })).toHaveLength(1)
    })
})
