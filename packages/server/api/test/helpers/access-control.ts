import { apId } from '@activepieces/core-utils'
import { AccessGrantWithPrincipal, AccessPrincipalType, AccessRole, FlowRunStatus, PopulatedFlow, RunEnvironment } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { db } from './db'
import { createMockFlowRun } from './mocks'
import { createMemberContext, createTestContext, TestContext } from './test-context'

async function createFlow({ ctx, folderId, displayName }: CreateFlowParams): Promise<PopulatedFlow> {
    const response = await ctx.post('/v1/flows', {
        displayName: displayName ?? `flow-${apId()}`,
        projectId: ctx.project.id,
        ...(folderId ? { folderId } : {}),
    })
    expect(response.statusCode).toBe(201)
    return response.json()
}

async function createFolder({ ctx, displayName }: { ctx: TestContext, displayName?: string }): Promise<{ id: string, displayName: string }> {
    const response = await ctx.post('/v1/folders', {
        projectId: ctx.project.id,
        displayName: displayName ?? `folder-${apId()}`,
    })
    expect(response.statusCode).toBe(200)
    return response.json()
}

async function createGroup({ platformId, displayName, memberIds }: CreateGroupParams): Promise<{ id: string, displayName: string }> {
    const group = {
        id: apId(),
        platformId,
        displayName: displayName ?? `group-${apId()}`,
        externalId: null,
    }
    await db.save('user_group', group)
    await Promise.all(memberIds.map((userId) => db.save('user_group_member', { id: apId(), groupId: group.id, userId })))
    return { id: group.id, displayName: group.displayName }
}

async function createRun({ projectId, flow, triggeredBy }: CreateRunParams): Promise<string> {
    const run = {
        ...createMockFlowRun({
            projectId,
            flowId: flow.id,
            flowVersionId: flow.version.id,
            status: FlowRunStatus.SUCCEEDED,
            environment: RunEnvironment.PRODUCTION,
        }),
        triggeredBy: triggeredBy ?? null,
    }
    await db.save('flow_run', run)
    return run.id
}

async function grant({ ctx, principalType, principalId, role, folderId, flowId }: GrantParams): Promise<AccessGrantWithPrincipal> {
    const response = await ctx.post('/v1/access-grants', {
        projectId: ctx.project.id,
        principalType,
        principalId,
        role,
        ...(folderId ? { folderId } : {}),
        ...(flowId ? { flowId } : {}),
    })
    expect(response.statusCode).toBe(201)
    return response.json()
}

async function grantToUser({ ctx, member, role, folderId, flowId }: GrantToUserParams): Promise<AccessGrantWithPrincipal> {
    return grant({ ctx, principalType: AccessPrincipalType.USER, principalId: member.user.id, role, folderId, flowId })
}

async function setup(app: FastifyInstance): Promise<AccessSetup> {
    const admin = await createTestContext(app)
    const memberOne = await createMemberContext(app, admin, { projectRole: 'none' })
    const memberTwo = await createMemberContext(app, admin, { projectRole: 'none' })
    const memberThree = await createMemberContext(app, admin, { projectRole: 'none' })
    return { admin, memberOne, memberTwo, memberThree }
}

export const accessTestUtils = {
    createFlow,
    createFolder,
    createGroup,
    createRun,
    grant,
    grantToUser,
    setup,
    roles: AccessRole,
}

type CreateFlowParams = {
    ctx: TestContext
    folderId?: string
    displayName?: string
}

type CreateGroupParams = {
    platformId: string
    displayName?: string
    memberIds: string[]
}

type CreateRunParams = {
    projectId: string
    flow: PopulatedFlow
    triggeredBy?: string
}

type GrantParams = {
    ctx: TestContext
    principalType: AccessPrincipalType
    principalId: string
    role: AccessRole
    folderId?: string
    flowId?: string
}

type GrantToUserParams = {
    ctx: TestContext
    member: TestContext
    role: AccessRole
    folderId?: string
    flowId?: string
}

type AccessSetup = {
    admin: TestContext
    memberOne: TestContext
    memberTwo: TestContext
    memberThree: TestContext
}
