import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { scimTestUtils } from '../../../helpers/scim'
import { createMemberContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('SCIM tokens admin API', () => {
    it('creates a token, returns the plaintext once and stores only its hash', async () => {
        const ctx = await createTestContext(app)

        const created = await ctx.post('/v1/scim-tokens', { displayName: 'JumpCloud' })

        expect(created.statusCode).toBe(StatusCodes.CREATED)
        const body = created.json()
        expect(body.token).toMatch(/^scim_[A-Za-z0-9_-]{43}$/)
        expect(body.platformId).toBe(ctx.platform.id)
        expect(body.displayName).toBe('JumpCloud')
        expect(body.lastUsedAt).toBeNull()

        const stored = await databaseConnection().getRepository('scim_token').findOneByOrFail({ id: body.id })
        expect(stored.tokenHash).not.toBe(body.token)
        expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/)

        const listed = await ctx.get('/v1/scim-tokens')
        expect(listed.statusCode).toBe(StatusCodes.OK)
        expect(listed.json().data).toHaveLength(1)
        expect(listed.json().data[0].token).toBeUndefined()
    })

    it('revokes a token and rejects it afterwards', async () => {
        const ctx = await createTestContext(app)
        const created = (await ctx.post('/v1/scim-tokens', { displayName: 'to revoke' })).json()
        const scim = scimTestUtils.scimClient({ app, token: created.token })
        expect((await scim.get('/Users')).statusCode).toBe(StatusCodes.OK)

        const revoked = await ctx.delete(`/v1/scim-tokens/${created.id}`)

        expect(revoked.statusCode).toBe(StatusCodes.NO_CONTENT)
        const afterRevoke = await scim.get('/Users')
        expect(afterRevoke.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(afterRevoke.headers['content-type']).toContain('application/scim+json')
        expect(afterRevoke.json().schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    })

    it('does not let an admin revoke a token of another platform', async () => {
        const ctx = await createTestContext(app)
        const other = await createTestContext(app)
        const created = (await other.post('/v1/scim-tokens', { displayName: 'other' })).json()

        const response = await ctx.delete(`/v1/scim-tokens/${created.id}`)

        expect(response.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect((await other.get('/v1/scim-tokens')).json().data).toHaveLength(1)
    })

    it('rejects missing, malformed and unknown bearer tokens', async () => {
        const noHeader = await app.inject({ method: 'GET', url: '/api/v1/scim/v2/Users' })
        const unknown = await scimTestUtils.scimClient({ app, token: 'scim_unknown' }).get('/Users')
        const wrongPrefix = await scimTestUtils.scimClient({ app, token: 'abc' }).get('/Users')

        expect(noHeader.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(unknown.statusCode).toBe(StatusCodes.UNAUTHORIZED)
        expect(wrongPrefix.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('records lastUsedAt after a SCIM request', async () => {
        const ctx = await createTestContext(app)
        const created = (await ctx.post('/v1/scim-tokens', { displayName: 'used' })).json()

        await scimTestUtils.scimClient({ app, token: created.token }).get('/ServiceProviderConfig')

        await vi.waitFor(async () => {
            const listed = (await ctx.get('/v1/scim-tokens')).json().data
            expect(listed[0].lastUsedAt).not.toBeNull()
        })
    })

    it('rejects non-admin users on the admin endpoints', async () => {
        const admin = await createTestContext(app)
        const member = await createMemberContext(app, admin, { projectRole: 'EDITOR' })

        expect((await member.get('/v1/scim-tokens')).statusCode).toBe(StatusCodes.FORBIDDEN)
        expect((await member.post('/v1/scim-tokens', { displayName: 'x' })).statusCode).toBe(StatusCodes.FORBIDDEN)
        expect((await member.delete('/v1/scim-tokens/abcdefghijklmnopqrstu')).statusCode).toBe(StatusCodes.FORBIDDEN)
        expect((await member.get('/v1/user-groups')).statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('rejects an invalid create body', async () => {
        const ctx = await createTestContext(app)

        const response = await ctx.post('/v1/scim-tokens', { displayName: '' })

        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })
})

describe('SCIM discovery', () => {
    it('serves ServiceProviderConfig, ResourceTypes and Schemas', async () => {
        const ctx = await createTestContext(app)
        const scim = scimTestUtils.scimClient({ app, token: await scimTestUtils.createToken(ctx) })

        const config = await scim.get('/ServiceProviderConfig')
        const resourceTypes = await scim.get('/ResourceTypes')
        const schemas = await scim.get('/Schemas')

        expect(config.statusCode).toBe(StatusCodes.OK)
        expect(config.headers['content-type']).toContain('application/scim+json')
        expect(config.json().patch.supported).toBe(true)
        expect(config.json().filter).toEqual({ supported: true, maxResults: 200 })
        expect(config.json().bulk.supported).toBe(false)
        expect(config.json().authenticationSchemes[0].type).toBe('oauthbearertoken')
        expect(resourceTypes.json().Resources.map((r: { id: string }) => r.id).sort()).toEqual(['Group', 'User'])
        expect(schemas.json().totalResults).toBe(2)
    })
})
