import { apId } from '@activepieces/core-utils'
import { PlatformRole, ProjectType, UserStatus } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { createMockUserIdentity } from '../../../helpers/mocks'
import { scimTestUtils } from '../../../helpers/scim'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
const D = `${apId().toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function setup() {
    const ctx = await createTestContext(app)
    const scim = scimTestUtils.scimClient({ app, token: await scimTestUtils.createToken(ctx) })
    return { ctx, scim }
}

async function createUser({ scim, userName, extra }: { scim: ReturnType<typeof scimTestUtils.scimClient>, userName: string, extra?: Record<string, unknown> }) {
    const response = await scim.post('/Users', scimTestUtils.userBody({ userName, ...extra }))
    expect(response.statusCode).toBe(StatusCodes.CREATED)
    return response.json()
}

describe('SCIM Users', () => {
    it('creates a user with a verified SAML identity, MEMBER role and a personal project', async () => {
        const { ctx, scim } = await setup()

        const response = await scim.post('/Users', scimTestUtils.userBody({ userName: `Jane.Doe@${D}`, externalId: 'jc-1' }))

        expect(response.statusCode).toBe(StatusCodes.CREATED)
        expect(response.headers['content-type']).toContain('application/scim+json')
        const body = response.json()
        expect(body.userName).toBe(`jane.doe@${D}`)
        expect(body.externalId).toBe('jc-1')
        expect(body.active).toBe(true)
        expect(body.name).toMatchObject({ givenName: 'Jane', familyName: 'Doe' })
        expect(body.meta.resourceType).toBe('User')

        const user = await databaseConnection().getRepository('user').findOneOrFail({ where: { id: body.id }, relations: { identity: true } })
        expect(user.platformId).toBe(ctx.platform.id)
        expect(user.platformRole).toBe(PlatformRole.MEMBER)
        expect(user.externalId).toBe('jc-1')
        expect(user.identity.verified).toBe(true)
        expect(user.identity.provider).toBe('SAML')
        expect(await databaseConnection().getRepository('project').countBy({ ownerId: user.id, type: ProjectType.PERSONAL })).toBe(1)
    })

    it('applies the platformRole of the custom schema', async () => {
        const { scim } = await setup()

        const body = await createUser({
            scim,
            userName: `op@${D}`,
            extra: { 'urn:ietf:params:scim:schemas:activepieces:1.0:CustomUserAttributes': { platformRole: PlatformRole.OPERATOR } },
        })

        expect(body['urn:ietf:params:scim:schemas:activepieces:1.0:CustomUserAttributes'].platformRole).toBe(PlatformRole.OPERATOR)
    })

    it('reuses an existing identity', async () => {
        const { scim } = await setup()
        const identity = createMockUserIdentity({ email: `elsewhere@${D}`, verified: true })
        await databaseConnection().getRepository('user_identity').save(identity)

        const body = await createUser({ scim, userName: `Elsewhere@${D}` })

        expect(await databaseConnection().getRepository('user_identity').countBy({ email: `elsewhere@${D}` })).toBe(1)
        const user = await databaseConnection().getRepository('user').findOneByOrFail({ id: body.id })
        expect(user.identityId).toBe(identity.id)
    })

    it('creates an inactive user and accepts string booleans', async () => {
        const { scim } = await setup()

        const body = await createUser({ scim, userName: `off@${D}`, extra: { active: 'False' } })

        expect(body.active).toBe(false)
    })

    it('returns 409 on a duplicate userName and 400 on an invalid one', async () => {
        const { scim } = await setup()
        await createUser({ scim, userName: `dup@${D}` })

        const duplicate = await scim.post('/Users', scimTestUtils.userBody({ userName: `DUP@${D}` }))
        const invalid = await scim.post('/Users', scimTestUtils.userBody({ userName: 'not-an-email' }))
        const malformed = await scim.post('/Users', { schemas: [] })

        expect(duplicate.statusCode).toBe(StatusCodes.CONFLICT)
        expect(duplicate.json().scimType).toBe('uniqueness')
        expect(invalid.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(malformed.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(malformed.json().schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    })

    it('gets a user and returns 404 for unknown ids', async () => {
        const { scim } = await setup()
        const created = await createUser({ scim, userName: `get@${D}` })

        const found = await scim.get(`/Users/${created.id}`)
        const missing = await scim.get('/Users/doesnotexist')

        expect(found.statusCode).toBe(StatusCodes.OK)
        expect(found.json().id).toBe(created.id)
        expect(missing.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(missing.json().status).toBe('404')
    })

    it('lists with the userName filter and paginates', async () => {
        const { scim } = await setup()
        await createUser({ scim, userName: `a@${D}` })
        await createUser({ scim, userName: `b@${D}` })
        await createUser({ scim, userName: `c@${D}` })

        const filtered = await scim.get('/Users', { filter: `userName eq "B@${D}"` })
        const firstPage = await scim.get('/Users', { startIndex: '1', count: '2' })
        const secondPage = await scim.get('/Users', { startIndex: '3', count: '2' })
        const unsupported = await scim.get('/Users', { filter: 'userName co "a"' })
        const countOnly = await scim.get('/Users', { count: '0' })

        expect(filtered.json().totalResults).toBe(1)
        expect(filtered.json().Resources[0].userName).toBe(`b@${D}`)
        expect(firstPage.json().totalResults).toBe(4)
        expect(firstPage.json().itemsPerPage).toBe(2)
        expect(firstPage.json().startIndex).toBe(1)
        expect(secondPage.json().Resources).toHaveLength(2)
        expect(secondPage.json().startIndex).toBe(3)
        expect(unsupported.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(unsupported.json().scimType).toBe('invalidFilter')
        expect(countOnly.json().Resources).toHaveLength(0)
        expect(countOnly.json().totalResults).toBe(4)
    })

    it('only exposes users of the token platform', async () => {
        const first = await setup()
        const second = await setup()
        const created = await createUser({ scim: first.scim, userName: `tenant@${D}` })

        const crossGet = await second.scim.get(`/Users/${created.id}`)
        const crossList = await second.scim.get('/Users', { filter: `userName eq "tenant@${D}"` })
        const crossDelete = await second.scim.delete(`/Users/${created.id}`)

        expect(crossGet.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(crossList.json().totalResults).toBe(0)
        expect(crossDelete.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('replaces a user with PUT', async () => {
        const { scim } = await setup()
        const created = await createUser({ scim, userName: `put@${D}`, extra: { externalId: 'x1' } })

        const response = await scim.put(`/Users/${created.id}`, scimTestUtils.userBody({
            userName: `put@${D}`,
            name: { givenName: 'Janet', familyName: 'Roe' },
            externalId: 'x2',
            active: false,
        }))

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json()).toMatchObject({ externalId: 'x2', active: false, name: { givenName: 'Janet', familyName: 'Roe' } })
    })

    describe('PATCH', () => {
        it('handles replace with no path and an object value', async () => {
            const { scim } = await setup()
            const created = await createUser({ scim, userName: `p1@${D}` })

            const deactivated = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', value: { active: false } }])
            const renamed = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', value: { name: { givenName: 'Ann', familyName: 'Lee' }, externalId: 'ext-9' } }])

            expect(deactivated.json().active).toBe(false)
            expect(renamed.json()).toMatchObject({ name: { givenName: 'Ann', familyName: 'Lee' }, externalId: 'ext-9', active: false })
        })

        it('handles path forms and case-insensitive ops with string booleans', async () => {
            const { scim } = await setup()
            const created = await createUser({ scim, userName: `p2@${D}` })

            const response = await scim.patch(`/Users/${created.id}`, [
                { op: 'Replace', path: 'active', value: 'False' },
                { op: 'REPLACE', path: 'name.givenName', value: 'Zed' },
                { op: 'replace', path: 'name.familyName', value: 'Quinn' },
                { op: 'Replace', path: 'externalId', value: 'e-1' },
            ])

            expect(response.statusCode).toBe(StatusCodes.OK)
            expect(response.json()).toMatchObject({ active: false, externalId: 'e-1', name: { givenName: 'Zed', familyName: 'Quinn' } })

            const reactivated = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'active', value: 'True' }])
            expect(reactivated.json().active).toBe(true)
        })

        it('changes the userName and the emails of a user', async () => {
            const { scim } = await setup()
            const created = await createUser({ scim, userName: `old@${D}` })

            const renamed = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `New@${D}` }])
            const reEmailed = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'emails[type eq "work"].value', value: `third@${D}` }])
            const withEmailsObject = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', value: { emails: [{ value: `fourth@${D}`, primary: true }] } }])

            expect(renamed.json().userName).toBe(`new@${D}`)
            expect(reEmailed.json().userName).toBe(`third@${D}`)
            expect(withEmailsObject.json().userName).toBe(`fourth@${D}`)
        })

        it('returns 409 when the new userName is taken and 400 for a bad boolean', async () => {
            const { scim } = await setup()
            await createUser({ scim, userName: `taken@${D}` })
            const created = await createUser({ scim, userName: `mover@${D}` })

            const conflict = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `taken@${D}` }])
            const bad = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'active', value: 'maybe' }])
            const noPathScalar = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', value: 'x' }])

            expect(conflict.statusCode).toBe(StatusCodes.CONFLICT)
            expect(bad.statusCode).toBe(StatusCodes.BAD_REQUEST)
            expect(noPathScalar.statusCode).toBe(StatusCodes.BAD_REQUEST)
        })
    })

    it('deactivates on DELETE without removing the user', async () => {
        const { scim } = await setup()
        const created = await createUser({ scim, userName: `del@${D}` })

        const deleted = await scim.delete(`/Users/${created.id}`)

        expect(deleted.statusCode).toBe(StatusCodes.NO_CONTENT)
        const stored = await databaseConnection().getRepository('user').findOneByOrFail({ id: created.id })
        expect(stored.status).toBe(UserStatus.INACTIVE)
        const fetched = await scim.get(`/Users/${created.id}`)
        expect(fetched.json().active).toBe(false)

        const reactivated = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', value: { active: true } }])
        expect(reactivated.json().active).toBe(true)
    })

    it('refuses to deactivate the platform owner', async () => {
        const { ctx, scim } = await setup()

        const response = await scim.delete(`/Users/${ctx.user.id}`)

        expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('accepts plain application/json bodies', async () => {
        const { ctx } = await setup()
        const token = await scimTestUtils.createToken(ctx)

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/scim/v2/Users',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify(scimTestUtils.userBody({ userName: `json@${D}` })),
        })

        expect(response.statusCode).toBe(StatusCodes.CREATED)
    })
})
