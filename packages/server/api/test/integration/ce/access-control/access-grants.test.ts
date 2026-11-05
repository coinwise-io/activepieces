import { apId } from '@activepieces/core-utils'
import { AccessGrantScope, AccessPrincipalType, AccessRole, Permission, PlatformRole, ProjectType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { accessTestUtils } from '../../../helpers/access-control'
import { db } from '../../../helpers/db'
import { createMockProject, mockBasicUser } from '../../../helpers/mocks'
import { createMemberContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Access grants CRUD', () => {
    it('lets a platform admin grant a role to a user on a project and lists it with the principal', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)

        const created = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })

        expect(created.scope).toBe(AccessGrantScope.PROJECT)
        expect(created.role).toBe(AccessRole.EDITOR)
        expect(created.principal).toMatchObject({ type: AccessPrincipalType.USER, id: memberOne.user.id, email: memberOne.userIdentity.email })
        expect(created.createdBy).toBe(admin.user.id)

        const list = await admin.get('/v1/access-grants', { projectId: admin.project.id })
        expect(list.statusCode).toBe(StatusCodes.OK)
        expect(list.json().data.map((grant: { id: string }) => grant.id)).toEqual([created.id])
    })

    it('grants to a group and reports the group principal', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, displayName: 'Compliance', memberIds: [memberOne.user.id] })

        const created = await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.HISTORY_READER })

        expect(created.principal).toEqual({ type: AccessPrincipalType.GROUP, id: group.id, displayName: 'Compliance' })
    })

    it('rejects a duplicate grant with 409', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })

        const duplicate = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberOne.user.id,
            role: AccessRole.EXECUTOR,
        })

        expect(duplicate.statusCode).toBe(StatusCodes.CONFLICT)
    })

    it('allows the same principal to hold different roles and different scopes', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })

        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER })
        const flowGrant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })

        expect(flowGrant.scope).toBe(AccessGrantScope.FLOW)
        expect(flowGrant.folderId).toBeNull()
    })

    it('rejects a principal from another platform', async () => {
        const { admin } = await accessTestUtils.setup(app)
        const otherPlatform = await createTestContext(app)
        const foreignMember = await createMemberContext(app, otherPlatform, { projectRole: 'none' })
        const foreignGroup = await accessTestUtils.createGroup({ platformId: otherPlatform.platform.id, memberIds: [] })

        const userResponse = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: foreignMember.user.id,
            role: AccessRole.EDITOR,
        })
        const groupResponse = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.GROUP,
            principalId: foreignGroup.id,
            role: AccessRole.EDITOR,
        })

        expect(userResponse.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(groupResponse.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('rejects a folder or flow that belongs to another project', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const otherProject = createMockProject({ platformId: admin.platform.id, ownerId: admin.user.id })
        await db.save('project', otherProject)
        const otherCtx = { ...admin, project: otherProject }
        const foreignFlow = await accessTestUtils.createFlow({ ctx: otherCtx })
        const foreignFolder = await accessTestUtils.createFolder({ ctx: otherCtx })

        const flowResponse = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberOne.user.id,
            role: AccessRole.EDITOR,
            flowId: foreignFlow.id,
        })
        const folderResponse = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberOne.user.id,
            role: AccessRole.EDITOR,
            folderId: foreignFolder.id,
        })
        const bothResponse = await admin.post('/v1/access-grants', {
            projectId: admin.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberOne.user.id,
            role: AccessRole.EDITOR,
            flowId: foreignFlow.id,
            folderId: foreignFolder.id,
        })

        expect(flowResponse.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(folderResponse.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(bothResponse.statusCode).toBe(StatusCodes.CONFLICT)
    })

    it('rejects grants on personal projects', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)

        const response = await memberOne.post('/v1/access-grants', {
            projectId: memberOne.project.id,
            principalType: AccessPrincipalType.USER,
            principalId: memberTwo.user.id,
            role: AccessRole.EDITOR,
        })

        expect(admin.project.type).toBe(ProjectType.TEAM)
        expect(memberOne.project.type).toBe(ProjectType.PERSONAL)
        expect(response.statusCode).toBe(StatusCodes.CONFLICT)
    })

    it('rejects callers that cannot manage access on the target', async () => {
        const { admin, memberOne, memberTwo, memberThree } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EXECUTOR })
        const body = { projectId: admin.project.id, principalType: AccessPrincipalType.USER, principalId: memberThree.user.id, role: AccessRole.EXECUTOR }

        const asHistoryReader = await memberOne.post('/v1/access-grants', body)
        const asExecutor = await memberTwo.post('/v1/access-grants', body)
        const asStranger = await memberThree.post('/v1/access-grants', body)

        expect(asHistoryReader.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(asExecutor.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(asStranger.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('lets a folder editor manage grants on its folder and its flows but not on the project', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const otherFolder = await accessTestUtils.createFolder({ ctx: admin })
        const flowInFolder = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, folderId: folder.id })
        const body = { projectId: admin.project.id, principalType: AccessPrincipalType.USER, principalId: memberTwo.user.id, role: AccessRole.EXECUTOR }

        const onFolder = await memberOne.post('/v1/access-grants', { ...body, folderId: folder.id })
        const onFlow = await memberOne.post('/v1/access-grants', { ...body, flowId: flowInFolder.id, role: AccessRole.HISTORY_READER })
        const onProject = await memberOne.post('/v1/access-grants', body)
        const onOtherFolder = await memberOne.post('/v1/access-grants', { ...body, folderId: otherFolder.id })

        expect(onFolder.statusCode).toBe(StatusCodes.CREATED)
        expect(onFlow.statusCode).toBe(StatusCodes.CREATED)
        expect(onProject.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(onOtherFolder.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('lists inherited grants for a flow with the scope of each', async () => {
        const { admin, memberOne, memberTwo, memberThree } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const flow = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        const otherFlow = await accessTestUtils.createFlow({ ctx: admin, folderId: folder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EXECUTOR, folderId: folder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberThree, role: AccessRole.HISTORY_READER, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberThree, role: AccessRole.HISTORY_READER, flowId: otherFlow.id })

        const response = await admin.get('/v1/access-grants', { projectId: admin.project.id, flowId: flow.id })

        const scopes = response.json().data.map((grant: { scope: string }) => grant.scope).sort()
        expect(scopes).toEqual([AccessGrantScope.FLOW, AccessGrantScope.FOLDER, AccessGrantScope.PROJECT].sort())
    })

    it('deletes a grant as a manager and rejects non-managers and unknown ids', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const created = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })

        const asMember = await memberOne.delete(`/v1/access-grants/${created.id}`)
        const unknown = await admin.delete(`/v1/access-grants/${apId()}`)
        const removed = await admin.delete(`/v1/access-grants/${created.id}`)
        const secondDelete = await admin.delete(`/v1/access-grants/${created.id}`)

        expect(asMember.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(unknown.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(removed.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect(secondDelete.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(memberTwo.user.id).not.toBe(memberOne.user.id)
    })

    it('hides grants of other platforms from a deletion attempt', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const outsider = await createTestContext(app)
        const created = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })

        const response = await outsider.delete(`/v1/access-grants/${created.id}`)

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        const stillThere = await db.findOneBy('access_grant', { id: created.id })
        expect(stillThere).not.toBeNull()
    })
})

describe('Access grant cascades', () => {
    it('removes flow grants when the flow is deleted and folder grants when the folder is deleted', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        const flowGrant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })
        const folderGrant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, folderId: folder.id })

        await db.delete('flow', flow.id)
        const deletedFolder = await admin.delete(`/v1/folders/${folder.id}`)

        expect(deletedFolder.statusCode).toBe(StatusCodes.OK)
        expect(await db.findOneBy('access_grant', { id: flowGrant.id })).toBeNull()
        expect(await db.findOneBy('access_grant', { id: folderGrant.id })).toBeNull()
    })

    it('removes grants when the group or the user is deleted', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [] })
        const groupGrant = await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.EDITOR })
        const userGrant = await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })

        await db.delete('user_group', group.id)
        await db.delete('project', memberOne.project.id)
        await db.delete('user', memberOne.user.id)

        expect(await db.findOneBy('access_grant', { id: groupGrant.id })).toBeNull()
        expect(await db.findOneBy('access_grant', { id: userGrant.id })).toBeNull()
    })
})

describe('Effective access', () => {
    it('reports roles, permissions and manage rights for the caller', async () => {
        const { admin, memberOne, memberTwo, memberThree } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR, flowId: flow.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EDITOR })

        const executorOnFlow = await memberOne.get('/v1/access-grants/effective', { projectId: admin.project.id, flowId: flow.id })
        const editorOnProject = await memberTwo.get('/v1/access-grants/effective', { projectId: admin.project.id })
        const adminOnFlow = await admin.get('/v1/access-grants/effective', { projectId: admin.project.id, flowId: flow.id })
        const stranger = await memberThree.get('/v1/access-grants/effective', { projectId: admin.project.id })

        expect(executorOnFlow.statusCode).toBe(StatusCodes.OK)
        expect(executorOnFlow.json().roles).toEqual([AccessRole.EXECUTOR])
        expect(executorOnFlow.json().permissions).toEqual(expect.arrayContaining([Permission.READ_FLOW, Permission.EXECUTE_FLOW, Permission.READ_RUN]))
        expect(executorOnFlow.json().permissions).not.toContain(Permission.WRITE_FLOW)
        expect(executorOnFlow.json().canManageAccess).toBe(false)
        expect(editorOnProject.json().roles).toEqual([AccessRole.EDITOR])
        expect(editorOnProject.json().permissions).toEqual(expect.arrayContaining([Permission.WRITE_FLOW, Permission.EXECUTE_FLOW]))
        expect(editorOnProject.json().canManageAccess).toBe(true)
        expect(adminOnFlow.json().canManageAccess).toBe(true)
        expect(adminOnFlow.json().permissions).toContain(Permission.WRITE_FLOW)
        expect(stranger.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('answers for a folder with folder and project grants', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        const folder = await accessTestUtils.createFolder({ ctx: admin })
        const other = await accessTestUtils.createFolder({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, folderId: folder.id })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberTwo, role: AccessRole.EXECUTOR })

        const editorOnFolder = await memberOne.get('/v1/access-grants/effective', { projectId: admin.project.id, folderId: folder.id })
        const editorOnOther = await memberOne.get('/v1/access-grants/effective', { projectId: admin.project.id, folderId: other.id })
        const executorOnFolder = await memberTwo.get('/v1/access-grants/effective', { projectId: admin.project.id, folderId: folder.id })

        expect(editorOnFolder.json().roles).toEqual([AccessRole.EDITOR])
        expect(editorOnFolder.json().canManageAccess).toBe(true)
        expect(editorOnFolder.json().permissions).toContain(Permission.WRITE_FLOW)
        expect(editorOnOther.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect(executorOnFolder.json().roles).toEqual([AccessRole.EXECUTOR])
        expect(executorOnFolder.json().canManageAccess).toBe(false)
    })

    it('limits permissions on a flow the caller has no role on', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        const granted = await accessTestUtils.createFlow({ ctx: admin })
        const other = await accessTestUtils.createFlow({ ctx: admin })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR, flowId: granted.id })

        const onGranted = await memberOne.get('/v1/access-grants/effective', { projectId: admin.project.id, flowId: granted.id })
        const onOther = await memberOne.get('/v1/access-grants/effective', { projectId: admin.project.id, flowId: other.id })

        expect(onGranted.json().permissions).toContain(Permission.WRITE_FLOW)
        expect(onOther.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('never offers access management on a personal project, even to its owner', async () => {
        const { memberOne } = await accessTestUtils.setup(app)
        const flow = await accessTestUtils.createFlow({ ctx: memberOne })
        const folder = await accessTestUtils.createFolder({ ctx: memberOne })

        const onProject = await memberOne.get('/v1/access-grants/effective', { projectId: memberOne.project.id })
        const onFlow = await memberOne.get('/v1/access-grants/effective', { projectId: memberOne.project.id, flowId: flow.id })
        const onFolder = await memberOne.get('/v1/access-grants/effective', { projectId: memberOne.project.id, folderId: folder.id })

        expect(memberOne.project.type).toBe(ProjectType.PERSONAL)
        expect(onProject.statusCode).toBe(StatusCodes.OK)
        expect(onProject.json().canManageAccess).toBe(false)
        expect(onFlow.statusCode).toBe(StatusCodes.OK)
        expect(onFlow.json().canManageAccess).toBe(false)
        expect(onFlow.json().permissions).toContain(Permission.WRITE_FLOW)
        expect(onFolder.statusCode).toBe(StatusCodes.OK)
        expect(onFolder.json().canManageAccess).toBe(false)
    })
})

describe('Access principals', () => {
    it('searches users and groups of the project platform only', async () => {
        const { admin, memberOne } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EDITOR })
        const needle = `needle${apId().toLowerCase().replace(/[^a-z0-9]/g, '')}`
        const { mockUser: insider } = await mockBasicUser({
            userIdentity: { email: `${needle}@inside.example.com`, firstName: 'Inside' },
            user: { platformId: admin.platform.id, platformRole: PlatformRole.MEMBER },
        })
        const outsider = await createTestContext(app)
        await mockBasicUser({
            userIdentity: { email: `${needle}@outside.example.com`, firstName: 'Outside' },
            user: { platformId: outsider.platform.id, platformRole: PlatformRole.MEMBER },
        })
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, displayName: `${needle}-group`, memberIds: [] })
        await accessTestUtils.createGroup({ platformId: outsider.platform.id, displayName: `${needle}-foreign`, memberIds: [] })

        const asAdmin = await admin.get('/v1/access-grants/principals', { projectId: admin.project.id, search: needle })
        const asEditor = await memberOne.get('/v1/access-grants/principals', { projectId: admin.project.id, search: needle })

        expect(asAdmin.statusCode).toBe(StatusCodes.OK)
        const ids = asAdmin.json().data.map((principal: { id: string }) => principal.id).sort()
        expect(ids).toEqual([insider.id, group.id].sort())
        expect(asEditor.statusCode).toBe(StatusCodes.OK)
    })

    it('rejects callers that cannot manage access anywhere in the project', async () => {
        const { admin, memberOne, memberTwo } = await accessTestUtils.setup(app)
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.HISTORY_READER })

        const asHistoryReader = await memberOne.get('/v1/access-grants/principals', { projectId: admin.project.id })
        const asStranger = await memberTwo.get('/v1/access-grants/principals', { projectId: admin.project.id })

        expect(asHistoryReader.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(asStranger.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})

describe('Project list for granted members', () => {
    it('includes team projects where the member holds a grant directly or through a group', async () => {
        const { admin, memberOne, memberTwo, memberThree } = await accessTestUtils.setup(app)
        const secondProject = createMockProject({ platformId: admin.platform.id, ownerId: admin.user.id })
        await db.save('project', secondProject)
        const group = await accessTestUtils.createGroup({ platformId: admin.platform.id, memberIds: [memberTwo.user.id] })
        await accessTestUtils.grantToUser({ ctx: admin, member: memberOne, role: AccessRole.EXECUTOR })
        await accessTestUtils.grant({ ctx: admin, principalType: AccessPrincipalType.GROUP, principalId: group.id, role: AccessRole.HISTORY_READER })

        const direct = await memberOne.get('/v1/projects')
        const viaGroup = await memberTwo.get('/v1/projects')
        const none = await memberThree.get('/v1/projects')

        const idsOf = (response: { json: () => { data: { id: string }[] } }) => response.json().data.map((project) => project.id)
        expect(idsOf(direct)).toEqual(expect.arrayContaining([admin.project.id, memberOne.project.id]))
        expect(idsOf(direct)).not.toContain(secondProject.id)
        expect(idsOf(viaGroup)).toContain(admin.project.id)
        expect(idsOf(none)).not.toContain(admin.project.id)
        expect(idsOf(none)).toContain(memberThree.project.id)
    })
})
