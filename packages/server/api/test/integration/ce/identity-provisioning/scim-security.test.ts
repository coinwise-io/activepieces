import { apId } from '@activepieces/core-utils'
import { PlatformRole, UserStatus } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { mockBasicUser } from '../../../helpers/mocks'
import { scimTestUtils } from '../../../helpers/scim'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const CUSTOM_SCHEMA = 'urn:ietf:params:scim:schemas:activepieces:1.0:CustomUserAttributes'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function uniqueDomain(): string {
    return `${apId().toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`
}

async function setup() {
    const ctx = await createTestContext(app)
    const scim = scimTestUtils.scimClient({ app, token: await scimTestUtils.createToken(ctx) })
    return { ctx, scim, domain: uniqueDomain() }
}

async function setVerifiedSsoDomain({ ctx, ssoDomain }: { ctx: TestContext, ssoDomain: string }): Promise<void> {
    await databaseConnection().getRepository('platform').update({ id: ctx.platform.id }, {
        ssoDomain,
        ssoDomainVerification: {
            status: 'VERIFIED',
            record: { type: 'TXT', name: `_ap-sso-verification.${ssoDomain}`, value: 'ap-sso-verification=test' },
            createdAt: new Date().toISOString(),
        },
    })
}

async function createUser({ scim, userName, extra }: { scim: ReturnType<typeof scimTestUtils.scimClient>, userName: string, extra?: Record<string, unknown> }) {
    const response = await scim.post('/Users', scimTestUtils.userBody({ userName, ...extra }))
    expect(response.statusCode).toBe(StatusCodes.CREATED)
    return response.json()
}

async function createAdmin({ ctx }: { ctx: TestContext }) {
    const { mockUser, mockUserIdentity } = await mockBasicUser({
        user: { platformId: ctx.platform.id, platformRole: PlatformRole.ADMIN },
    })
    return { id: mockUser.id, email: mockUserIdentity.email }
}

describe('SCIM cannot escalate to admin', () => {
    it('rejects the ADMIN role on create, replace and patch but allows OPERATOR', async () => {
        const { scim, domain } = await setup()

        const created = await scim.post('/Users', scimTestUtils.userBody({ userName: `a@${domain}`, [CUSTOM_SCHEMA]: { platformRole: 'ADMIN' } }))
        const operator = await createUser({ scim, userName: `o@${domain}`, extra: { [CUSTOM_SCHEMA]: { platformRole: 'OPERATOR' } } })
        const replaced = await scim.put(`/Users/${operator.id}`, scimTestUtils.userBody({ userName: `o@${domain}`, [CUSTOM_SCHEMA]: { platformRole: 'ADMIN' } }))
        const patched = await scim.patch(`/Users/${operator.id}`, [{ op: 'replace', value: { [CUSTOM_SCHEMA]: { platformRole: 'ADMIN' } } }])
        const patchedPath = await scim.patch(`/Users/${operator.id}`, [{ op: 'replace', path: `${CUSTOM_SCHEMA}:platformRole`, value: 'ADMIN' }])

        expect(created.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(created.json().scimType).toBe('invalidValue')
        expect(created.json().detail).toContain('ADMIN')
        expect(replaced.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(patched.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(patchedPath.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect((await scim.get('/Users', { filter: `userName eq "a@${domain}"` })).json().totalResults).toBe(0)
        expect((await scim.get(`/Users/${operator.id}`)).json()[CUSTOM_SCHEMA].platformRole).toBe(PlatformRole.OPERATOR)
        const member = await scim.patch(`/Users/${operator.id}`, [{ op: 'replace', value: { [CUSTOM_SCHEMA]: { platformRole: 'MEMBER' } } }])
        expect(member.json()[CUSTOM_SCHEMA].platformRole).toBe(PlatformRole.MEMBER)
    })

    it('refuses every change to an existing admin', async () => {
        const { ctx, scim } = await setup()
        const admin = await createAdmin({ ctx })

        const deactivate = await scim.patch(`/Users/${admin.id}`, [{ op: 'replace', value: { active: false } }])
        const remove = await scim.delete(`/Users/${admin.id}`)
        const demote = await scim.patch(`/Users/${admin.id}`, [{ op: 'replace', value: { [CUSTOM_SCHEMA]: { platformRole: 'MEMBER' } } }])
        const rename = await scim.patch(`/Users/${admin.id}`, [{ op: 'replace', path: 'name.givenName', value: 'Mallory' }])
        const replace = await scim.put(`/Users/${admin.id}`, scimTestUtils.userBody({ userName: admin.email, active: false }))

        for (const response of [deactivate, remove, demote, rename, replace]) {
            expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
            expect(response.json().detail).toContain('admin')
        }
        const stored = await databaseConnection().getRepository('user').findOneByOrFail({ id: admin.id })
        expect(stored.status).toBe(UserStatus.ACTIVE)
        expect(stored.platformRole).toBe(PlatformRole.ADMIN)
    })
})

describe('SCIM and identities shared across platforms', () => {
    it('returns 409 when the email belongs to an account on another platform', async () => {
        const { scim } = await setup()
        const other = await createTestContext(app)

        const response = await scim.post('/Users', scimTestUtils.userBody({ userName: other.userIdentity.email }))

        expect(response.statusCode).toBe(StatusCodes.CONFLICT)
        expect(response.json().scimType).toBe('uniqueness')
    })

    it('reuses the identity when the email domain is the verified SSO domain, but locks its name and email', async () => {
        const { ctx, scim, domain } = await setup()
        const other = await createTestContext(app)
        const email = `shared@${domain}`
        await databaseConnection().getRepository('user_identity').update({ id: other.userIdentity.id }, { email })
        await setVerifiedSsoDomain({ ctx, ssoDomain: domain })

        const created = await createUser({ scim, userName: email })
        const rename = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'name.givenName', value: 'Changed' }])
        const move = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `moved@${email.split('@')[1]}` }])
        const externalId = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'externalId', value: 'ext-1' }])

        const user = await databaseConnection().getRepository('user').findOneByOrFail({ id: created.id })
        expect(user.identityId).toBe(other.userIdentity.id)
        expect(rename.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(rename.json().scimType).toBe('mutability')
        expect(move.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(move.json().scimType).toBe('mutability')
        expect(externalId.statusCode).toBe(StatusCodes.OK)
        const identity = await databaseConnection().getRepository('user_identity').findOneByOrFail({ id: other.userIdentity.id })
        expect(identity.email).toBe(email)
        expect(identity.firstName).toBe(other.userIdentity.firstName)
    })

    it('invalidates sessions by rotating the tokenVersion when the email changes', async () => {
        const { scim, domain } = await setup()
        const created = await createUser({ scim, userName: `before@${domain}` })
        const before = await databaseConnection().getRepository('user').findOneOrFail({ where: { id: created.id }, relations: { identity: true } })

        const response = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `after@${domain}` }])

        expect(response.statusCode).toBe(StatusCodes.OK)
        const after = await databaseConnection().getRepository('user_identity').findOneByOrFail({ id: before.identityId })
        expect(after.email).toBe(`after@${domain}`)
        expect(after.tokenVersion).not.toBe(before.identity.tokenVersion)
    })

    it('does not rotate the tokenVersion when only the name changes', async () => {
        const { scim, domain } = await setup()
        const created = await createUser({ scim, userName: `same@${domain}` })
        const before = await databaseConnection().getRepository('user').findOneOrFail({ where: { id: created.id }, relations: { identity: true } })

        await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'name.givenName', value: 'Renamed' }])

        const after = await databaseConnection().getRepository('user_identity').findOneByOrFail({ id: before.identityId })
        expect(after.tokenVersion).toBe(before.identity.tokenVersion)
        expect(after.firstName).toBe('Renamed')
    })
})

describe('SCIM and the verified SSO domain', () => {
    it('requires userName to be in the domain on create and on change', async () => {
        const { ctx, scim, domain } = await setup()
        await setVerifiedSsoDomain({ ctx, ssoDomain: domain })

        const outside = await scim.post('/Users', scimTestUtils.userBody({ userName: `x@other-${domain}` }))
        const created = await createUser({ scim, userName: `in@${domain}` })
        const moveOutside = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `x@other-${domain}` }])
        const replaceOutside = await scim.put(`/Users/${created.id}`, scimTestUtils.userBody({ userName: `x@other-${domain}` }))
        const moveInside = await scim.patch(`/Users/${created.id}`, [{ op: 'replace', path: 'userName', value: `in2@${domain}` }])

        expect(outside.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(outside.json().scimType).toBe('invalidValue')
        expect(moveOutside.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(moveOutside.json().scimType).toBe('invalidValue')
        expect(replaceOutside.statusCode).toBe(StatusCodes.BAD_REQUEST)
        expect(moveInside.statusCode).toBe(StatusCodes.OK)
    })

    it('does not restrict the domain while it is unverified', async () => {
        const { ctx, scim, domain } = await setup()
        await databaseConnection().getRepository('platform').update({ id: ctx.platform.id }, {
            ssoDomain: domain,
            ssoDomainVerification: {
                status: 'PENDING_VERIFICATION',
                record: { type: 'TXT', name: `_ap-sso-verification.${domain}`, value: 'ap-sso-verification=test' },
                createdAt: new Date().toISOString(),
            },
        })

        const response = await scim.post('/Users', scimTestUtils.userBody({ userName: `free@other-${domain}` }))

        expect(response.statusCode).toBe(StatusCodes.CREATED)
    })
})

describe('SCIM PUT without active', () => {
    it('keeps the current status', async () => {
        const { scim, domain } = await setup()
        const created = await createUser({ scim, userName: `inactive@${domain}`, extra: { active: false } })
        const body = scimTestUtils.userBody({ userName: `inactive@${domain}` })
        delete body.active

        const response = await scim.put(`/Users/${created.id}`, body)

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().active).toBe(false)
    })
})

describe('SCIM request bounds', () => {
    it.each<Record<string, string>>([
        { startIndex: '0' },
        { startIndex: '-5' },
        { startIndex: '1000001' },
        { startIndex: 'abc' },
        { startIndex: '1.5' },
        { count: '-1' },
        { count: '201' },
        { count: 'abc' },
    ])('rejects invalid pagination %j with 400 invalidValue', async (query) => {
        const { scim } = await setup()

        const users = await scim.get('/Users', query)
        const groups = await scim.get('/Groups', query)

        for (const response of [users, groups]) {
            expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
            expect(response.json().scimType).toBe('invalidValue')
        }
    })

    it('accepts the pagination bounds', async () => {
        const { scim } = await setup()

        const response = await scim.get('/Users', { startIndex: '1000000', count: '200' })

        expect(response.statusCode).toBe(StatusCodes.OK)
    })

    it('rejects more than 1000 members in one create, replace or patch', async () => {
        const { scim } = await setup()
        const group = await scim.post('/Groups', scimTestUtils.groupBody({ displayName: 'Bounded' }))
        const groupId = group.json().id
        const tooMany = Array.from({ length: 1001 }, (_, index) => ({ value: `user-${index}` }))

        const create = await scim.post('/Groups', scimTestUtils.groupBody({ displayName: 'Huge', members: tooMany }))
        const replace = await scim.put(`/Groups/${groupId}`, scimTestUtils.groupBody({ displayName: 'Bounded', members: tooMany }))
        const add = await scim.patch(`/Groups/${groupId}`, [{ op: 'add', path: 'members', value: tooMany }])
        const replaceMembers = await scim.patch(`/Groups/${groupId}`, [{ op: 'replace', path: 'members', value: tooMany }])

        for (const response of [create, replace, add, replaceMembers]) {
            expect(response.statusCode).toBe(StatusCodes.BAD_REQUEST)
            expect(response.json().scimType).toBe('tooMany')
        }
    })
})
