import { apId } from '@activepieces/core-utils'
import { AccessPrincipalType, AccessRole, PrincipalType, UserStatus, WebsocketServerEvent } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { Socket } from 'socket.io'
import { vi } from 'vitest'
import { websocketService } from '../../../../src/app/core/websockets.service'
import { scimGroupService } from '../../../../src/app/identity-provisioning/scim/scim-group.service'
import { userService } from '../../../../src/app/user/user-service'
import { accessTestUtils } from '../../../helpers/access-control'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { createMockConnection } from '../../../helpers/mocks'
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

async function saveConnection({ admin }: { admin: TestContext }): Promise<{ id: string, externalId: string }> {
    const connection = createMockConnection({ platformId: admin.platform.id, projectIds: [admin.project.id] }, admin.user.id)
    await db.save('app_connection', connection)
    return { id: connection.id, externalId: connection.externalId }
}

describe('Connections and variables for narrow editors', () => {
    it('lets a flow editor read connection and variable metadata but not change, replace, delete or reveal', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        const connection = await saveConnection({ admin })
        const other = await saveConnection({ admin })
        const variable = await admin.post('/v1/variables', { projectId: admin.project.id, name: `v_${apId().replace(/[^a-zA-Z0-9]/g, '')}`, value: 'secret' })
        expect(variable.statusCode).toBe(StatusCodes.CREATED)
        const variableId = variable.json().id

        const listConnections = await memberOne.get('/v1/app-connections', { projectId: admin.project.id })
        const getConnection = await memberOne.get(`/v1/app-connections/${connection.id}`)
        const listVariables = await memberOne.get('/v1/variables', { projectId: admin.project.id })
        const update = await memberOne.post(`/v1/app-connections/${connection.id}`, { displayName: 'hijacked' })
        const revalidate = await memberOne.post(`/v1/app-connections/${connection.id}/revalidate`, {})
        const replace = await memberOne.post('/v1/app-connections/replace', { projectId: admin.project.id, sourceAppConnectionId: connection.id, targetAppConnectionId: other.id, deleteSourceConnection: true, applyToPublishedVersions: true })
        const remove = await memberOne.delete(`/v1/app-connections/${connection.id}`)
        const upsertOverExisting = await memberOne.post('/v1/app-connections', {
            projectId: admin.project.id,
            externalId: connection.externalId,
            displayName: 'overwrite',
            pieceName: '@activepieces/piece-slack',
            pieceVersion: '0.0.1',
            type: 'SECRET_TEXT',
            value: { type: 'SECRET_TEXT', secret_text: 'x' },
        })
        const updateVariable = await memberOne.post(`/v1/variables/${variableId}`, { value: 'changed' })
        const reveal = await memberOne.post(`/v1/variables/${variableId}/reveal`, {})
        const removeVariable = await memberOne.delete(`/v1/variables/${variableId}`)
        const adminReveal = await admin.post(`/v1/variables/${variableId}/reveal`, {})

        expect(listConnections.statusCode).not.toBe(StatusCodes.FORBIDDEN)
        expect(getConnection.statusCode).not.toBe(StatusCodes.FORBIDDEN)
        expect(listVariables.statusCode).toBe(StatusCodes.OK)
        for (const response of [update, revalidate, replace, remove, upsertOverExisting, updateVariable, reveal, removeVariable]) {
            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        }
        expect(adminReveal.statusCode).toBe(StatusCodes.OK)
        expect(adminReveal.json().value).toBe('secret')
    })

    it('lets a flow editor create a new variable and lets a project editor delete connections', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR })
        const connection = await saveConnection({ admin })

        const created = await memberOne.post('/v1/variables', { projectId: admin.project.id, name: `n_${apId().replace(/[^a-zA-Z0-9]/g, '')}`, value: 'x' })
        const removed = await memberTwo.delete(`/v1/app-connections/${connection.id}`)

        expect(created.statusCode).toBe(StatusCodes.CREATED)
        expect(removed.statusCode).toBe(StatusCodes.NO_CONTENT)
    })
})

describe('Piece options', () => {
    it('requires edit on the flow, or project-scope editor when no flow is given', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const mine = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: mine.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.HISTORY_READER, flowId: mine.id })
        const body = { projectId: admin.project.id, pieceName: '@activepieces/piece-slack', pieceVersion: '0.0.1', actionOrTriggerName: 'a', propertyName: 'p', input: {} }

        const otherFlow = await memberOne.post('/v1/pieces/options', { ...body, flowId: other.id })
        const otherVersion = await memberOne.post('/v1/pieces/options', { ...body, flowVersionId: other.version.id })
        const noFlow = await memberOne.post('/v1/pieces/options', body)
        const readerOnOwn = await memberTwo.post('/v1/pieces/options', { ...body, flowId: mine.id })

        expect(otherFlow.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(otherVersion.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(noFlow.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(readerOnOwn.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})

describe('Access grants hardening', () => {
    it('requires manage rights to list grants and hides targets the caller has no role on', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const hidden = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR, flowId: flow.id })

        const asExecutor = await memberOne.get('/v1/access-grants', { projectId: admin.project.id, flowId: flow.id })
        const asEditor = await memberTwo.get('/v1/access-grants', { projectId: admin.project.id, flowId: flow.id })
        const hiddenTarget = await memberTwo.get('/v1/access-grants', { projectId: admin.project.id, flowId: hidden.id })

        expect(asExecutor.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(asEditor.statusCode).toBe(StatusCodes.OK)
        expect(hiddenTarget.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('restricts principal search to 3 characters and 20 results for project editors and to exact matches for narrow editors', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR })
        const needle = `grp${apId().toLowerCase().replace(/[^a-z0-9]/g, '')}`
        await Promise.all(Array.from({ length: 25 }, (_, index) => accessTestUtils.createGroup({ platformId: admin.platform.id, displayName: `${needle}-${index}`, memberIds: [] })))

        const empty = await memberTwo.get('/v1/access-grants/principals', { projectId: admin.project.id })
        const short = await memberTwo.get('/v1/access-grants/principals', { projectId: admin.project.id, search: 'gr' })
        const narrow = await memberTwo.get('/v1/access-grants/principals', { projectId: admin.project.id, search: needle })
        const narrowEditor = await memberOne.get('/v1/access-grants/principals', { projectId: admin.project.id, search: needle })
        const asAdmin = await admin.get('/v1/access-grants/principals', { projectId: admin.project.id, search: needle })

        expect(empty.json().data).toEqual([])
        expect(short.json().data).toEqual([])
        expect(narrow.json().data).toHaveLength(20)
        expect(narrowEditor.json().data).toEqual([])
        expect(asAdmin.json().data).toHaveLength(25)
    })
})

describe('Folders and flow moves', () => {
    it('stops a flow editor from moving the flow into a folder they cannot edit and counts only visible flows', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const mine = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        const target = await accessTestUtils.createFolder({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: mine.id })

        const move = await memberOne.post(`/v1/flows/${mine.id}`, { type: 'CHANGE_FOLDER', request: { folderId: target.id } })
        const toRoot = await memberOne.post(`/v1/flows/${mine.id}`, { type: 'CHANGE_FOLDER', request: { folderId: null } })
        const list = await memberOne.get('/v1/folders', { projectId: admin.project.id, limit: 100 })
        const single = await memberOne.get(`/v1/folders/${folder.id}`)

        expect(move.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(toRoot.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(list.json().data).toHaveLength(1)
        expect(list.json().data[0].numberOfFlows).toBe(1)
        expect(single.json().numberOfFlows).toBe(1)
    })
})

describe('Websocket access', () => {
    it('evicts a socket from the run and project rooms and disconnects it when its grant is deleted', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const grant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        expect(tab.socket.rooms.has(admin.project.id)).toBe(true)
        expect(tab.socket.rooms.has(`${admin.project.id}:run-viewers`)).toBe(true)
        mockIo({ sockets: [tab.socket] })

        const response = await admin.delete(`/v1/access-grants/${grant.id}`)

        expect(response.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect(tab.socket.disconnected).toBe(true)
    })

    it('narrows rooms when a project grant is replaced by a flow grant', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const grant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })
        mockIo({ sockets: [tab.socket] })

        await admin.delete(`/v1/access-grants/${grant.id}`)

        expect(tab.socket.disconnected).toBe(false)
        expect(tab.socket.rooms.has(admin.project.id)).toBe(false)
        expect(tab.socket.rooms.has(`${admin.project.id}:run-viewers`)).toBe(false)
    })

    it('evicts a narrow member from the flow room when the flow grant is deleted', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const kept = await accessTestUtils.createFlow({ ctx: admin })
        const grant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: kept.id })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        await tab.emit({ event: WebsocketServerEvent.JOIN_PRESENCE, data: { resourceId: flow.id } })
        expect(tab.socket.rooms.has(websocketService.resourceRoom(flow.id))).toBe(true)
        mockIo({ sockets: [tab.socket] })

        await admin.delete(`/v1/access-grants/${grant.id}`)

        expect(tab.socket.disconnected).toBe(false)
        expect(tab.socket.rooms.has(websocketService.resourceRoom(flow.id))).toBe(false)
    })

    it('disconnects a member whose group is removed through SCIM', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberOne.user.id] })
        await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.EDITOR })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        mockIo({ sockets: [tab.socket] })

        await scimGroupService.delete({ platformId: admin.platform.id, id: group.id })

        expect(tab.socket.disconnected).toBe(true)
    })

    it('disconnects a member who is deactivated', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })
        mockIo({ sockets: [tab.socket] })

        await userService(app.log).update({ id: memberOne.user.id, platformId: admin.platform.id, status: UserStatus.INACTIVE })

        expect(tab.socket.disconnected).toBe(true)
    })

    it('lets a narrow member join presence only for flows they can see', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const visible = await accessTestUtils.createFlow({ ctx: admin })
        const hidden = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: visible.id })
        const tab = await openTab({ userId: memberOne.user.id, platformId: admin.platform.id, projectId: admin.project.id })

        expect(tab.socket.rooms.has(admin.project.id)).toBe(false)
        const joinedVisible = await tab.emit({ event: WebsocketServerEvent.JOIN_PRESENCE, data: { resourceId: visible.id } })
        const joinedHidden = await tab.emit({ event: WebsocketServerEvent.JOIN_PRESENCE, data: { resourceId: hidden.id } })

        expect(joinedVisible.users).toHaveLength(1)
        expect(joinedHidden.users).toEqual([])
        expect(tab.socket.rooms.has(websocketService.resourceRoom(visible.id))).toBe(true)
        expect(tab.socket.rooms.has(websocketService.resourceRoom(hidden.id))).toBe(false)
    })
})

async function openTab({ userId, platformId, projectId }: { userId: string, platformId: string, projectId: string }): Promise<Tab> {
    const token = await generateMockToken({ id: userId, type: PrincipalType.USER, platform: { id: platformId } })
    const handlers: Record<string, (data: unknown, callback?: (value: unknown) => void) => unknown> = {}
    const middlewares: ((packet: unknown[], next: () => void) => void)[] = []
    const socket: FakeSocket = {
        id: apId(),
        data: {},
        rooms: new Set<string>(),
        disconnected: false,
        handshake: { auth: { token, projectId } },
        join: async (room: string): Promise<void> => {
            socket.rooms.add(room)
        },
        leave: async (room: string): Promise<void> => {
            socket.rooms.delete(room)
        },
        disconnect: (): void => {
            socket.disconnected = true
        },
        use: (middleware): void => {
            middlewares.push(middleware)
        },
        on: (event, handler): void => {
            handlers[event] = handler
        },
        once: (): void => undefined,
        emit: (): boolean => true,
        to: (): { emit: () => boolean } => ({ emit: () => true }),
    }
    await websocketService.init(socket as unknown as Socket, app.log)
    return {
        socket,
        emit: ({ event, data }) => new Promise((resolve, reject) => {
            const handler = handlers[event]
            if (!handler) {
                reject(new Error(`no handler for ${event}`))
                return
            }
            Promise.resolve(handler(data, (value) => resolve(value as { users: unknown[] }))).catch(reject)
        }),
    }
}

function mockIo({ sockets }: { sockets: FakeSocket[] }): void {
    vi.spyOn(app.io, 'in').mockImplementation((room) => {
        const rooms = [room].flat()
        const members = sockets.filter((socket) => rooms.some((name) => socket.rooms.has(name)))
        const broadcast = { fetchSockets: async () => members }
        return broadcast as unknown as ReturnType<typeof app.io.in>
    })
}

type FakeSocket = {
    id: string
    data: Record<string, unknown>
    rooms: Set<string>
    disconnected: boolean
    handshake: { auth: { token: string, projectId: string } }
    join: (room: string) => Promise<void>
    leave: (room: string) => Promise<void>
    disconnect: () => void
    use: (middleware: (packet: unknown[], next: () => void) => void) => void
    on: (event: string, handler: (data: unknown, callback?: (value: unknown) => void) => unknown) => void
    once: () => void
    emit: () => boolean
    to: () => { emit: () => boolean }
}

type Tab = {
    socket: FakeSocket
    emit: (params: { event: WebsocketServerEvent, data: unknown }) => Promise<{ users: unknown[] }>
}
