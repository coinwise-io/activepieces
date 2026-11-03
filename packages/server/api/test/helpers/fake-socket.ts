import { apId } from '@activepieces/core-utils'
import { PrincipalType, WebsocketServerEvent } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { Socket } from 'socket.io'
import { websocketService } from '../../src/app/core/websockets.service'
import { generateMockToken } from './auth'

async function open({ app, userId, platformId, projectId }: OpenParams): Promise<FakeSocketTab> {
    const token = await generateMockToken({ id: userId, type: PrincipalType.USER, platform: { id: platformId } })
    const handlers: Record<string, (data: unknown, callback?: (value: unknown) => void) => unknown> = {}
    const emitted: EmittedEvent[] = []
    const rooms = new Set<string>()
    const socket = {
        id: apId(),
        data: {},
        rooms,
        disconnected: false,
        handshake: { auth: { token, projectId } },
        join: async (room: string): Promise<void> => {
            rooms.add(room)
        },
        leave: async (room: string): Promise<void> => {
            rooms.delete(room)
        },
        disconnect: (): void => {
            socket.disconnected = true
        },
        use: (): void => undefined,
        on: (event: string, handler: (data: unknown, callback?: (value: unknown) => void) => unknown): void => {
            handlers[event] = handler
        },
        once: (): void => undefined,
        emit: (event: string, data: unknown): boolean => {
            emitted.push({ event, data })
            return true
        },
        to: (): { emit: () => boolean } => ({ emit: () => true }),
    }
    await websocketService.init(socket as unknown as Socket, app.log)
    return {
        emitted,
        fire: ({ event, data }) => {
            const handler = handlers[event]
            if (!handler) {
                throw new Error(`no handler for ${event}`)
            }
            handler(data)
        },
    }
}

async function waitFor({ condition, timeoutMs }: { condition: () => boolean, timeoutMs: number }): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (condition()) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return condition()
}

export const fakeSocket = {
    open,
    waitFor,
}

type EmittedEvent = {
    event: string
    data: unknown
}

type OpenParams = {
    app: FastifyInstance
    userId: string
    platformId: string
    projectId: string
}

export type FakeSocketTab = {
    emitted: EmittedEvent[]
    fire: (params: { event: WebsocketServerEvent, data: unknown }) => void
}
