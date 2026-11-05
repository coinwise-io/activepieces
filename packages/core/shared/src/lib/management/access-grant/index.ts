import { BaseModelSchema, Nullable, Permission } from '@activepieces/core-utils'
import { z } from 'zod'

export enum AccessRole {
    EDITOR = 'EDITOR',
    EXECUTOR = 'EXECUTOR',
    HISTORY_READER = 'HISTORY_READER',
}

export enum AccessGrantScope {
    PROJECT = 'PROJECT',
    FOLDER = 'FOLDER',
    FLOW = 'FLOW',
}

export enum AccessPrincipalType {
    USER = 'USER',
    GROUP = 'GROUP',
}

export const AccessGrant = z.object({
    ...BaseModelSchema,
    platformId: z.string(),
    projectId: z.string(),
    folderId: Nullable(z.string()),
    flowId: Nullable(z.string()),
    userId: Nullable(z.string()),
    groupId: Nullable(z.string()),
    role: z.enum(AccessRole),
    createdBy: Nullable(z.string()),
})

export type AccessGrant = z.infer<typeof AccessGrant>

export const AccessGrantPrincipal = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(AccessPrincipalType.USER),
        id: z.string(),
        email: z.string(),
        firstName: z.string(),
        lastName: z.string(),
    }),
    z.object({
        type: z.literal(AccessPrincipalType.GROUP),
        id: z.string(),
        displayName: z.string(),
    }),
])

export type AccessGrantPrincipal = z.infer<typeof AccessGrantPrincipal>

export const AccessGrantWithPrincipal = AccessGrant.extend({
    scope: z.enum(AccessGrantScope),
    principal: AccessGrantPrincipal,
})

export type AccessGrantWithPrincipal = z.infer<typeof AccessGrantWithPrincipal>

export const AccessTarget = z.object({
    projectId: z.string().min(1),
    folderId: z.string().min(1).optional(),
    flowId: z.string().min(1).optional(),
})

export type AccessTarget = z.infer<typeof AccessTarget>

export const ListAccessGrantsRequest = AccessTarget

export type ListAccessGrantsRequest = z.infer<typeof ListAccessGrantsRequest>

export const ListAccessGrantsResponse = z.object({
    data: z.array(AccessGrantWithPrincipal),
})

export type ListAccessGrantsResponse = z.infer<typeof ListAccessGrantsResponse>

export const CreateAccessGrantRequest = AccessTarget.extend({
    principalType: z.enum(AccessPrincipalType),
    principalId: z.string().min(1),
    role: z.enum(AccessRole),
})

export type CreateAccessGrantRequest = z.infer<typeof CreateAccessGrantRequest>

export const GetEffectiveAccessRequest = z.object({
    projectId: z.string().min(1),
    folderId: z.string().min(1).optional(),
    flowId: z.string().min(1).optional(),
})

export type GetEffectiveAccessRequest = z.infer<typeof GetEffectiveAccessRequest>

export const EffectiveAccess = z.object({
    roles: z.array(z.enum(AccessRole)),
    permissions: z.array(z.enum(Permission)),
    canManageAccess: z.boolean(),
})

export type EffectiveAccess = z.infer<typeof EffectiveAccess>

export const ListAccessPrincipalsRequest = z.object({
    projectId: z.string().min(1),
    search: z.string().trim().max(100).optional(),
})

export type ListAccessPrincipalsRequest = z.infer<typeof ListAccessPrincipalsRequest>

export const ListAccessPrincipalsResponse = z.object({
    data: z.array(AccessGrantPrincipal),
})

export type ListAccessPrincipalsResponse = z.infer<typeof ListAccessPrincipalsResponse>
