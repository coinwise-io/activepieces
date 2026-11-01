import { apId } from '@activepieces/core-utils'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
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

type Scim = ReturnType<typeof scimTestUtils.scimClient>

async function setup() {
    const ctx = await createTestContext(app)
    const scim = scimTestUtils.scimClient({ app, token: await scimTestUtils.createToken(ctx) })
    return { ctx, scim }
}

async function createUser({ scim, userName }: { scim: Scim, userName: string }): Promise<string> {
    const response = await scim.post('/Users', scimTestUtils.userBody({ userName }))
    return response.json().id
}

async function createGroup({ scim, displayName, memberIds }: { scim: Scim, displayName: string, memberIds?: string[] }) {
    const response = await scim.post('/Groups', scimTestUtils.groupBody({
        displayName,
        members: (memberIds ?? []).map((value) => ({ value })),
    }))
    expect(response.statusCode).toBe(StatusCodes.CREATED)
    return response.json()
}

function memberValues(body: { members: { value: string }[] }): string[] {
    return body.members.map((member) => member.value).sort()
}

describe('SCIM Groups', () => {
    it('creates a group with members', async () => {
        const { scim } = await setup()
        const u1 = await createUser({ scim, userName: `g1@${D}` })
        const u2 = await createUser({ scim, userName: `g2@${D}` })

        const body = await createGroup({ scim, displayName: 'Engineering', memberIds: [u1, u2] })

        expect(body.displayName).toBe('Engineering')
        expect(memberValues(body)).toEqual([u1, u2].sort())
        expect(body.meta.resourceType).toBe('Group')
    })

    it('rejects duplicate displayName with 409 and unknown or foreign members with 400', async () => {
        const first = await setup()
        const second = await setup()
        const foreign = await createUser({ scim: second.scim, userName: `foreign@${D}` })
        await createGroup({ scim: first.scim, displayName: 'Ops' })

        const duplicate = await first.scim.post('/Groups', scimTestUtils.groupBody({ displayName: 'Ops' }))
        const unknown = await first.scim.post('/Groups', scimTestUtils.groupBody({ displayName: 'X', members: [{ value: 'nope' }] }))
        const crossPlatform = await first.scim.post('/Groups', scimTestUtils.groupBody({ displayName: 'Y', members: [{ value: foreign }] }))

        expect(duplicate.statusCode).toBe(StatusCodes.CONFLICT)
        expect(unknown.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(crossPlatform.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('gets, lists with the displayName filter and paginates', async () => {
        const { scim } = await setup()
        const a = await createGroup({ scim, displayName: 'Alpha' })
        await createGroup({ scim, displayName: 'Beta' })
        await createGroup({ scim, displayName: 'Gamma' })

        const found = await scim.get(`/Groups/${a.id}`)
        const filtered = await scim.get('/Groups', { filter: 'displayName eq "beta"' })
        const page = await scim.get('/Groups', { startIndex: '2', count: '1' })
        const missing = await scim.get('/Groups/nope')

        expect(found.json().displayName).toBe('Alpha')
        expect(filtered.json().totalResults).toBe(1)
        expect(filtered.json().Resources[0].displayName).toBe('Beta')
        expect(page.json().totalResults).toBe(3)
        expect(page.json().Resources).toHaveLength(1)
        expect(missing.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('replaces displayName and members with PUT', async () => {
        const { scim } = await setup()
        const u1 = await createUser({ scim, userName: `r1@${D}` })
        const u2 = await createUser({ scim, userName: `r2@${D}` })
        const group = await createGroup({ scim, displayName: 'Old', memberIds: [u1] })

        const response = await scim.put(`/Groups/${group.id}`, scimTestUtils.groupBody({ displayName: 'New', members: [{ value: u2 }] }))

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().displayName).toBe('New')
        expect(memberValues(response.json())).toEqual([u2])
    })

    describe('PATCH', () => {
        it('adds members, with the add value as an array', async () => {
            const { scim } = await setup()
            const u1 = await createUser({ scim, userName: `a1@${D}` })
            const u2 = await createUser({ scim, userName: `a2@${D}` })
            const group = await createGroup({ scim, displayName: 'G', memberIds: [u1] })

            const response = await scim.patch(`/Groups/${group.id}`, [{ op: 'Add', path: 'members', value: [{ value: u2 }, { value: u1 }] }])

            expect(memberValues(response.json())).toEqual([u1, u2].sort())
        })

        it('removes members with the filter path and with a value array', async () => {
            const { scim } = await setup()
            const u1 = await createUser({ scim, userName: `x1@${D}` })
            const u2 = await createUser({ scim, userName: `x2@${D}` })
            const u3 = await createUser({ scim, userName: `x3@${D}` })
            const group = await createGroup({ scim, displayName: 'G', memberIds: [u1, u2, u3] })

            const byFilter = await scim.patch(`/Groups/${group.id}`, [{ op: 'remove', path: `members[value eq "${u1}"]` }])
            const byValue = await scim.patch(`/Groups/${group.id}`, [{ op: 'remove', path: 'members', value: [{ value: u2 }] }])

            expect(memberValues(byFilter.json())).toEqual([u2, u3].sort())
            expect(memberValues(byValue.json())).toEqual([u3])
        })

        it('removes all members with remove on members without a value', async () => {
            const { scim } = await setup()
            const u1 = await createUser({ scim, userName: `all@${D}` })
            const group = await createGroup({ scim, displayName: 'G', memberIds: [u1] })

            const response = await scim.patch(`/Groups/${group.id}`, [{ op: 'remove', path: 'members' }])

            expect(response.json().members).toEqual([])
        })

        it('replaces members and displayName, with and without a path', async () => {
            const { scim } = await setup()
            const u1 = await createUser({ scim, userName: `rp1@${D}` })
            const u2 = await createUser({ scim, userName: `rp2@${D}` })
            const group = await createGroup({ scim, displayName: 'G', memberIds: [u1] })

            const replacedMembers = await scim.patch(`/Groups/${group.id}`, [{ op: 'replace', path: 'members', value: [{ value: u2 }] }])
            const renamedWithPath = await scim.patch(`/Groups/${group.id}`, [{ op: 'replace', path: 'displayName', value: 'Renamed' }])
            const renamedNoPath = await scim.patch(`/Groups/${group.id}`, [{ op: 'replace', value: { displayName: 'Renamed Again' } }])

            expect(memberValues(replacedMembers.json())).toEqual([u2])
            expect(renamedWithPath.json().displayName).toBe('Renamed')
            expect(renamedNoPath.json().displayName).toBe('Renamed Again')
            expect(memberValues(renamedNoPath.json())).toEqual([u2])
        })

        it('returns 409 when renaming onto an existing group and 400 for unknown members', async () => {
            const { scim } = await setup()
            await createGroup({ scim, displayName: 'Taken' })
            const group = await createGroup({ scim, displayName: 'Other' })

            const conflict = await scim.patch(`/Groups/${group.id}`, [{ op: 'replace', path: 'displayName', value: 'Taken' }])
            const unknown = await scim.patch(`/Groups/${group.id}`, [{ op: 'add', path: 'members', value: [{ value: 'ghost' }] }])

            expect(conflict.statusCode).toBe(StatusCodes.CONFLICT)
            expect(unknown.statusCode).toBe(StatusCodes.BAD_REQUEST)
        })
    })

    it('deletes a group but keeps its users, and removes membership when a user is deleted', async () => {
        const { scim } = await setup()
        const u1 = await createUser({ scim, userName: `keep@${D}` })
        const group = await createGroup({ scim, displayName: 'Temp', memberIds: [u1] })

        const deleted = await scim.delete(`/Groups/${group.id}`)

        expect(deleted.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect((await scim.get(`/Groups/${group.id}`)).statusCode).toBe(StatusCodes.NOT_FOUND)
        expect((await scim.get(`/Users/${u1}`)).statusCode).toBe(StatusCodes.OK)
        expect(await databaseConnection().getRepository('user_group_member').countBy({ groupId: group.id })).toBe(0)
    })

    it('does not expose groups across platforms', async () => {
        const first = await setup()
        const second = await setup()
        const group = await createGroup({ scim: first.scim, displayName: 'Private' })

        expect((await second.scim.get(`/Groups/${group.id}`)).statusCode).toBe(StatusCodes.NOT_FOUND)
        expect((await second.scim.delete(`/Groups/${group.id}`)).statusCode).toBe(StatusCodes.NOT_FOUND)
        expect((await second.scim.get('/Groups')).json().totalResults).toBe(0)
    })
})

describe('GET /v1/user-groups', () => {
    it('lists the groups of the platform with their members', async () => {
        const { ctx, scim } = await setup()
        const other = await setup()
        const u1 = await createUser({ scim, userName: `list1@${D}` })
        await createGroup({ scim, displayName: 'Platform', memberIds: [u1] })
        await createGroup({ scim: other.scim, displayName: 'Other platform' })

        const response = await ctx.get('/v1/user-groups')

        expect(response.statusCode).toBe(StatusCodes.OK)
        const data = response.json().data
        expect(data).toHaveLength(1)
        expect(data[0].displayName).toBe('Platform')
        expect(data[0].platformId).toBe(ctx.platform.id)
        expect(data[0].members).toEqual([{ id: u1, email: `list1@${D}`, firstName: 'Jane', lastName: 'Doe' }])
    })
})
