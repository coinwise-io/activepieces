import { FastifyInstance } from 'fastify'
import { TestContext } from './test-context'

const SCIM_BASE = '/api/v1/scim/v2'
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

async function createToken(ctx: TestContext): Promise<string> {
    const response = await ctx.post('/v1/scim-tokens', { displayName: 'jumpcloud' })
    return response.json().token
}

function scimClient({ app, token }: { app: FastifyInstance, token: string }) {
    const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: Record<string, unknown>, query?: Record<string, string>) => {
        return app.inject({
            method,
            url: `${SCIM_BASE}${path}`,
            headers: {
                authorization: `Bearer ${token}`,
                ...(body ? { 'content-type': 'application/scim+json' } : {}),
            },
            query,
            body: body ? JSON.stringify(body) : undefined,
        })
    }
    return {
        get: (path: string, query?: Record<string, string>) => send('GET', path, undefined, query),
        post: (path: string, body: Record<string, unknown>) => send('POST', path, body),
        put: (path: string, body: Record<string, unknown>) => send('PUT', path, body),
        patch: (path: string, operations: Record<string, unknown>[]) => send('PATCH', path, { schemas: [PATCH_SCHEMA], Operations: operations }),
        delete: (path: string) => send('DELETE', path),
    }
}

function userBody({ userName, ...rest }: { userName: string } & Record<string, unknown>): Record<string, unknown> {
    return {
        schemas: [USER_SCHEMA],
        userName,
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: userName, type: 'work', primary: true }],
        active: true,
        ...rest,
    }
}

function groupBody({ displayName, ...rest }: { displayName: string } & Record<string, unknown>): Record<string, unknown> {
    return {
        schemas: [GROUP_SCHEMA],
        displayName,
        ...rest,
    }
}

export const scimTestUtils = {
    createToken,
    scimClient,
    userBody,
    groupBody,
}
