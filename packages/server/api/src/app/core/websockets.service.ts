import { ActivepiecesError, ErrorCode, isNil, Permission, tryCatch } from '@activepieces/core-utils'
import { ApiToWorkerContract, createNotifyClient, Principal, PrincipalForType, PrincipalType, UserStatus, WebsocketServerEvent } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Socket } from 'socket.io'
import { In } from 'typeorm'
import { accessPolicy, FlowRef, ProjectAccess } from '../access-control/access-policy'
import { accessTokenManager } from '../authentication/lib/access-token-manager'
import { flowRepo } from '../flows/flow/flow.repo'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { projectAccess } from '../project/project-access'
import { app } from '../server'
import { userService } from '../user/user-service'

export type WebsocketListener<T, PR extends PrincipalType.USER | PrincipalType.WORKER> = (socket: Socket) => (data: T, principal: PrincipalForType<PR>, projectId: PR extends PrincipalType.USER ? string : null, callback?: (data: unknown) => void) => Promise<void>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerMap<PR extends PrincipalType.USER | PrincipalType.WORKER> = Partial<Record<WebsocketServerEvent, WebsocketListener<any, PR>>>

const WORKERS_ROOM = 'WORKERS'
const RESOURCE_ROOM_PREFIX = 'resource:'

const listener = {
    [PrincipalType.USER]: {} as ListenerMap<PrincipalType.USER>,
    [PrincipalType.WORKER]: {} as ListenerMap<PrincipalType.WORKER>,
}

const eventPermissions: Partial<Record<WebsocketServerEvent, Permission>> = {}

export const websocketService = {
    to: (workerId: string) => app!.io.to(workerId),
    userHasPermission: async ({ userId, projectId, permission, log }: UserHasPermissionParams): Promise<boolean> => {
        const decision = await resolveDecision({ userId, projectId, log })
        return hasPermission(decision.access, permission)
    },
    toResourceAudience: ({ projectId, resourceId }: { projectId: string, resourceId: string }) => app!.io.to([projectId, resourceRoomName(resourceId)]),
    async joinResourceRoom({ socket, resourceId, flow, userId, projectId, log }: JoinResourceRoomParams): Promise<boolean> {
        const decision = await resolveDecision({ userId, projectId, log })
        const access = decision.access
        const allowed = !isNil(access) && decision.active && (isNil(flow)
            ? access.permissions.includes(Permission.READ_TABLE)
            : accessPolicy.canOnFlow({ access, flow, capability: 'SEE' }))
        if (allowed) {
            await socket.join(resourceRoomName(resourceId))
        }
        return allowed
    },
    resourceRoom: (resourceId: string): string => resourceRoomName(resourceId),
    async refreshAccessForProject({ projectId, log = app!.log }: { projectId: string, log?: FastifyBaseLogger }): Promise<void> {
        const { error } = await tryCatch(async () => refreshSockets({ sockets: await app!.io.in(memberSocketsRoomName(projectId)).fetchSockets(), log }))
        if (!isNil(error)) {
            log.error({ error, project: { id: projectId } }, 'Failed to refresh websocket access for project')
        }
    },
    async refreshAccessForUsers({ userIds, log = app!.log }: { userIds: string[], log?: FastifyBaseLogger }): Promise<void> {
        if (userIds.length === 0) {
            return
        }
        const { error } = await tryCatch(async () => refreshSockets({ sockets: await app!.io.in(userIds).fetchSockets(), log }))
        if (!isNil(error)) {
            log.error({ error }, 'Failed to refresh websocket access for users')
        }
    },
    toRunViewers: ({ projectId, triggeredBy }: ToRunViewersParams) => {
        const rooms = isNil(triggeredBy) ? [runViewersRoomName(projectId)] : [runViewersRoomName(projectId), triggeredBy]
        return app!.io.to(rooms)
    },
    notifyWorkers: () => createNotifyClient<ApiToWorkerContract>(app!.io.to(WORKERS_ROOM)),
    async init(socket: Socket, log: FastifyBaseLogger): Promise<void> {
        const listenersAttached = attachListeners({ socket, log })
        socket.use((_packet, next) => {
            listenersAttached.finally(() => next()).catch(() => undefined)
        })
        await listenersAttached
    },
    async verifyPrincipal(socket: Socket): Promise<Principal> {
        return accessTokenManager(app!.log).verifyPrincipal(socket.handshake.auth.token)
    },
    addListener<T, PR extends PrincipalType.WORKER | PrincipalType.USER>(principalType: PR, event: WebsocketServerEvent, handler: WebsocketListener<T, PR>, permission?: Permission): void {
        switch (principalType) {
            case PrincipalType.USER: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                listener[PrincipalType.USER][event] = handler as unknown as WebsocketListener<any, PrincipalType.USER>
                if (!isNil(permission)) {
                    eventPermissions[event] = permission
                }
                break
            }
            case PrincipalType.WORKER: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                listener[PrincipalType.WORKER][event] = handler as unknown as WebsocketListener<any, PrincipalType.WORKER>
                break
            }
        }
    },
    emitWithAck<T = unknown>(event: WebsocketServerEvent, workerId: string, data?: unknown): Promise<T> {
        return app!.io.to([workerId]).timeout(4000).emitWithAck(event, data)
    },
}

async function attachListeners({ socket, log }: AttachListenersParams): Promise<void> {
    const principal = await websocketService.verifyPrincipal(socket)
    const type = principal.type
    if (![PrincipalType.USER, PrincipalType.WORKER].includes(type)) {
        return
    }

    const castedType = type as keyof typeof listener
    const projectId = socket.handshake.auth.projectId
    switch (type) {
        case PrincipalType.USER: {
            const access = await validateProjectId({ userId: principal.id, projectId, log })
            socket.data.userId = principal.id
            socket.data.projectId = projectId
            log.info({
                message: 'User connected',
                user: { id: principal.id },
                project: { id: projectId },
            })
            await socket.join(principal.id)
            await socket.join(memberSocketsRoomName(projectId))
            if (seesWholeProject({ access })) {
                await socket.join(projectId)
            }
            if (canReadAllRuns({ access })) {
                await socket.join(runViewersRoomName(projectId))
            }
            break
        }
        case PrincipalType.WORKER: {
            const workerId = socket.handshake.auth.workerId
            log.info({
                message: 'Worker connected',
                worker: { id: workerId },
            })
            await socket.join(workerId)
            await socket.join(WORKERS_ROOM)
            break
        }
        default: {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHENTICATION,
                params: {
                    message: 'Invalid principal type',
                },
            })
        }
    }
    for (const [event, handler] of Object.entries(listener[castedType])) {
        // Socket.IO emits the reserved lowercase 'disconnect' per-socket; map our DISCONNECT enum
        // onto it or the handler never fires (it never did — worker cleanup relied on the 60s sweep).
        const socketEvent = event === WebsocketServerEvent.DISCONNECT ? 'disconnect' : event
        socket.on(socketEvent, async (data, callback) => {
            // Permissions are a project-role concept, so they only apply to USER principals.
            const requiredPermission = castedType === PrincipalType.USER
                ? eventPermissions[event as WebsocketServerEvent]
                : undefined
            if (!isNil(requiredPermission) && !(await websocketService.userHasPermission({ userId: principal.id, projectId, permission: requiredPermission, log }))) {
                log.warn({ event, userId: principal.id, projectId, requiredPermission }, 'Websocket event blocked: missing permission')
                return
            }
            return rejectedPromiseHandler(handler(socket)(data, principal, projectId, callback), log)
        })
    }
}

const validateProjectId = async ({ userId, projectId, log }: ValidateProjectIdArgs): Promise<ProjectAccess> => {
    if (isNil(projectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHENTICATION,
            params: {
                message: 'Project ID is required',
            },
        })
    }
    const access = await projectAccess(log).resolveForUser({
        projectId,
        userId,
    })

    if (isNil(access)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User not allowed to access this project',
            },
        })
    }
    return access
}

async function resolveDecision({ userId, projectId, log }: { userId: string, projectId: string, log: FastifyBaseLogger }): Promise<AccessDecision> {
    const { data, error } = await tryCatch(async () => {
        const user = await userService(log).getOneOrFail({ id: userId })
        const access = await projectAccess(log).resolveForUser({ userId, projectId })
        return { access, active: user.status === UserStatus.ACTIVE }
    })
    if (!isNil(error) || isNil(data)) {
        return { access: null, active: false }
    }
    return data
}

function seesWholeProject({ access }: { access: ProjectAccess }): boolean {
    return access.unrestricted || accessPolicy.rolesOnProject({ access }).length > 0
}

function canReadAllRuns({ access }: { access: ProjectAccess }): boolean {
    return accessPolicy.hasCapability({ roles: accessPolicy.rolesOnProject({ access }), capability: 'READ_RUNS' })
}

async function refreshSockets({ sockets, log }: { sockets: ManagedSocket[], log: FastifyBaseLogger }): Promise<void> {
    const decisions = new Map<string, Promise<AccessDecision>>()
    for (const socket of sockets) {
        const { userId, projectId } = socket.data
        if (typeof userId !== 'string' || typeof projectId !== 'string') {
            continue
        }
        const key = `${userId}|${projectId}`
        const decision = decisions.get(key) ?? resolveDecision({ userId, projectId, log })
        decisions.set(key, decision)
        const { error } = await tryCatch(async () => applyDecision({ socket, projectId, decision: await decision }))
        if (!isNil(error)) {
            log.error({ error, user: { id: userId }, project: { id: projectId } }, 'Failed to refresh websocket access')
        }
    }
}

async function applyDecision({ socket, projectId, decision }: { socket: ManagedSocket, projectId: string, decision: AccessDecision }): Promise<void> {
    const access = decision.access
    if (isNil(access) || !decision.active) {
        socket.disconnect(true)
        return
    }
    const wholeProject = seesWholeProject({ access })
    await syncRoom({ socket, room: projectId, shouldBeIn: wholeProject })
    await syncRoom({ socket, room: runViewersRoomName(projectId), shouldBeIn: canReadAllRuns({ access }) })
    if (wholeProject) {
        return
    }
    const resourceIds = [...socket.rooms].filter((room) => room.startsWith(RESOURCE_ROOM_PREFIX)).map((room) => room.slice(RESOURCE_ROOM_PREFIX.length))
    if (resourceIds.length === 0) {
        return
    }
    const flows = await flowRepo().find({ select: { id: true, folderId: true }, where: { id: In(resourceIds), projectId } })
    for (const resourceId of resourceIds) {
        const flow = flows.find((candidate) => candidate.id === resourceId)
        const visible = !isNil(flow) && accessPolicy.canOnFlow({ access, flow: { id: flow.id, folderId: flow.folderId ?? null }, capability: 'SEE' })
        await syncRoom({ socket, room: resourceRoomName(resourceId), shouldBeIn: visible })
    }
}

async function syncRoom({ socket, room, shouldBeIn }: { socket: ManagedSocket, room: string, shouldBeIn: boolean }): Promise<void> {
    const isIn = socket.rooms.has(room)
    if (shouldBeIn && !isIn) {
        await socket.join(room)
    }
    if (!shouldBeIn && isIn) {
        await socket.leave(room)
    }
}

function resourceRoomName(resourceId: string): string {
    return `${RESOURCE_ROOM_PREFIX}${resourceId}`
}

function hasPermission(access: ProjectAccess | null, permission: Permission): boolean {
    return !isNil(access) && access.permissions.includes(permission)
}

function runViewersRoomName(projectId: string): string {
    return `${projectId}:run-viewers`
}

function memberSocketsRoomName(projectId: string): string {
    return `${projectId}:member-sockets`
}

type ValidateProjectIdArgs = {
    userId: string
    projectId?: string
    log: FastifyBaseLogger
}

type ToRunViewersParams = {
    projectId: string
    triggeredBy: string | null | undefined
}

type UserHasPermissionParams = {
    userId: string
    projectId: string
    permission: Permission
    log: FastifyBaseLogger
}

type JoinResourceRoomParams = {
    socket: Socket
    resourceId: string
    flow: FlowRef | null
    userId: string
    projectId: string
    log: FastifyBaseLogger
}

type AccessDecision = {
    access: ProjectAccess | null
    active: boolean
}

type ManagedSocket = {
    data: Record<string, unknown>
    rooms: Set<string>
    join: (room: string) => Promise<void> | void
    leave: (room: string) => Promise<void> | void
    disconnect: (close?: boolean) => unknown
}

type AttachListenersParams = {
    socket: Socket
    log: FastifyBaseLogger
}
