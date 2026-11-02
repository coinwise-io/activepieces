import { BaseModelSchema, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export const ScimToken = z.object({
    ...BaseModelSchema,
    platformId: z.string(),
    displayName: z.string(),
    lastUsedAt: Nullable(z.string()),
})

export type ScimToken = z.infer<typeof ScimToken>

export const CreateScimTokenRequest = z.object({
    displayName: z.string().min(1).max(100),
})

export type CreateScimTokenRequest = z.infer<typeof CreateScimTokenRequest>

export const CreateScimTokenResponse = ScimToken.extend({
    token: z.string(),
})

export type CreateScimTokenResponse = z.infer<typeof CreateScimTokenResponse>

export const ListScimTokensResponse = z.object({
    data: z.array(ScimToken),
})

export type ListScimTokensResponse = z.infer<typeof ListScimTokensResponse>

export const UserGroup = z.object({
    ...BaseModelSchema,
    platformId: z.string(),
    displayName: z.string(),
    externalId: Nullable(z.string()),
})

export type UserGroup = z.infer<typeof UserGroup>

export const UserGroupMember = z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
})

export type UserGroupMember = z.infer<typeof UserGroupMember>

export const UserGroupWithMembers = UserGroup.extend({
    members: z.array(UserGroupMember),
})

export type UserGroupWithMembers = z.infer<typeof UserGroupWithMembers>

export const ListUserGroupsResponse = z.object({
    data: z.array(UserGroupWithMembers),
})

export type ListUserGroupsResponse = z.infer<typeof ListUserGroupsResponse>

export const ClaimSamlLoginRequest = z.object({
    code: z.string().min(1),
})

export type ClaimSamlLoginRequest = z.infer<typeof ClaimSamlLoginRequest>
