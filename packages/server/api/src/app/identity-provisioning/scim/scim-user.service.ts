import { isNil } from '@activepieces/core-utils'
import { cryptoUtils } from '@activepieces/server-utils'
import { CreateScimUserRequest, parseScimFilter, PlatformRole, ReplaceScimUserRequest, SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA, SCIM_LIST_RESPONSE_SCHEMA, SCIM_USER_SCHEMA, SsoDomainVerificationStatus, UserIdentityProvider, UserStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { userIdentityRepository, userIdentityService } from '../../authentication/user-identity/user-identity-service'
import { platformService } from '../../platform/platform.service'
import { userRepo, userService } from '../../user/user-service'
import { scimErrors } from './scim-errors'
import { ScimPatchOperationInput, scimPatchUtils, ScimUserPatchState } from './scim-patch'

const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 100

export const scimUserService = (log: FastifyBaseLogger) => ({
    async list({ platformId, filter, startIndex, count, baseUrl }: ListParams): Promise<ScimUserListResult> {
        const userName = parseScimFilter(filter, 'userName')
        const externalId = parseScimFilter(filter, 'externalId')
        if (!isNil(filter) && filter.trim() !== '' && isNil(userName) && isNil(externalId)) {
            throw scimErrors.badRequest({ detail: 'Only "userName eq" and "externalId eq" filters are supported', scimType: 'invalidFilter' })
        }
        const query = userRepo()
            .createQueryBuilder('usr')
            .innerJoinAndSelect('usr.identity', 'identity')
            .where('usr.platformId = :platformId', { platformId })
        if (!isNil(userName)) {
            query.andWhere('LOWER(identity.email) = :userName', { userName })
        }
        if (!isNil(externalId)) {
            query.andWhere('LOWER(usr.externalId) = :externalId', { externalId })
        }
        const pageSize = clampCount({ count })
        const start = Math.max(startIndex ?? 1, 1)
        const totalResults = await query.getCount()
        const users = pageSize === 0
            ? []
            : await query.orderBy('usr.created', 'ASC').addOrderBy('usr.id', 'ASC').skip(start - 1).take(pageSize).getMany()
        return {
            schemas: [SCIM_LIST_RESPONSE_SCHEMA],
            totalResults,
            startIndex: start,
            itemsPerPage: users.length,
            Resources: users.map((user) => toResource({ user, baseUrl })),
        }
    },
    async get({ platformId, id, baseUrl }: IdParams): Promise<ScimUserResourceBody> {
        const user = await findUserOrThrow({ platformId, id })
        return toResource({ user, baseUrl })
    },
    async create({ platformId, request, baseUrl }: CreateParams): Promise<ScimUserResourceBody> {
        const email = normalizeUserName({ userName: request.userName })
        assertRoleAllowed({ platformRole: request[SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]?.platformRole })
        const ssoDomain = await loadVerifiedSsoDomain({ log, platformId })
        assertEmailInSsoDomain({ email, ssoDomain })
        const existingIdentity = await userIdentityService(log).getIdentityByEmail(email)
        if (!isNil(existingIdentity)) {
            const existingUser = await userService(log).getOneByIdentityAndPlatform({ identityId: existingIdentity.id, platformId })
            if (!isNil(existingUser)) {
                throw scimErrors.conflict({ detail: `userName ${email} already exists` })
            }
            await assertIdentityReusable({ identityId: existingIdentity.id, platformId, email, ssoDomain })
        }
        const externalId = request.externalId ?? null
        await assertExternalIdAvailable({ log, platformId, externalId, userId: null })
        const identity = existingIdentity ?? await userIdentityService(log).create({
            email,
            password: await cryptoUtils.generateRandomPassword(),
            firstName: request.name?.givenName ?? fallbackFirstName({ email, formatted: request.name?.formatted }),
            lastName: request.name?.familyName ?? '',
            trackEvents: false,
            newsLetter: false,
            provider: UserIdentityProvider.SAML,
            verified: true,
        })
        const platformRole = request[SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]?.platformRole
        const { user: created } = await userService(log).getOrCreateWithProject({ identity, platformId, platformRole })
        const user = await findUserOrThrow({ platformId, id: created.id })
        const initial = toState({ user })
        await persistState({
            log,
            platformId,
            user,
            next: {
                ...initial,
                externalId,
                active: isNil(request.active) ? true : scimPatchUtils.parseBoolean({ value: request.active }),
            },
        })
        return toResource({ user: await findUserOrThrow({ platformId, id: created.id }), baseUrl })
    },
    async replace({ platformId, id, request, baseUrl }: ReplaceParams): Promise<ScimUserResourceBody> {
        const user = await findUserOrThrow({ platformId, id })
        const current = toState({ user })
        await persistState({
            log,
            platformId,
            user,
            next: {
                ...current,
                userName: normalizeUserName({ userName: request.userName }),
                userNameChanged: true,
                externalId: request.externalId ?? null,
                firstName: isNil(request.name) ? current.firstName : request.name.givenName ?? '',
                lastName: isNil(request.name) ? current.lastName : request.name.familyName ?? '',
                active: isNil(request.active) ? current.active : scimPatchUtils.parseBoolean({ value: request.active }),
                platformRole: request[SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]?.platformRole ?? null,
            },
        })
        return toResource({ user: await findUserOrThrow({ platformId, id }), baseUrl })
    },
    async patch({ platformId, id, operations, baseUrl }: PatchParams): Promise<ScimUserResourceBody> {
        const user = await findUserOrThrow({ platformId, id })
        const next = scimPatchUtils.applyUserPatch({ operations, state: toState({ user }) })
        await persistState({ log, platformId, user, next })
        return toResource({ user: await findUserOrThrow({ platformId, id }), baseUrl })
    },
    async deactivate({ platformId, id }: Omit<IdParams, 'baseUrl'>): Promise<void> {
        const user = await findUserOrThrow({ platformId, id })
        await persistState({ log, platformId, user, next: { ...toState({ user }), active: false } })
    },
})

async function findUserOrThrow({ platformId, id }: { platformId: string, id: string }) {
    const user = await userRepo().findOne({ where: { id, platformId }, relations: { identity: true } })
    if (isNil(user)) {
        throw scimErrors.notFound({ detail: `User ${id} not found` })
    }
    return user
}

async function persistState({ log, platformId, user, next }: PersistParams): Promise<void> {
    const identity = user.identity
    const email = scimPatchUtils.resolveEmail({ state: next })
    assertRoleAllowed({ platformRole: next.platformRole })
    const emailChanged = email !== identity.email
    const namesChanged = next.firstName !== identity.firstName || next.lastName !== identity.lastName
    const externalIdChanged = next.externalId !== user.externalId
    const status = next.active ? UserStatus.ACTIVE : UserStatus.INACTIVE
    const statusChanged = status !== user.status
    const roleChanged = !isNil(next.platformRole) && next.platformRole !== user.platformRole
    const changed = emailChanged || namesChanged || externalIdChanged || statusChanged || roleChanged
    if (changed && user.platformRole === PlatformRole.ADMIN) {
        throw scimErrors.badRequest({ detail: 'Platform admins cannot be changed through SCIM, manage them in the application', scimType: 'mutability' })
    }
    if (emailChanged || namesChanged) {
        await assertIdentityOwnedOnlyBy({ identityId: identity.id, platformId })
    }
    if (emailChanged) {
        assertEmailInSsoDomain({ email, ssoDomain: await loadVerifiedSsoDomain({ log, platformId }) })
        await changeEmail({ log, identityId: identity.id, email })
    }
    if (namesChanged) {
        await userIdentityService(log).update(identity.id, { firstName: next.firstName, lastName: next.lastName })
    }
    if (externalIdChanged) {
        await assertExternalIdAvailable({ log, platformId, externalId: next.externalId, userId: user.id })
        await userRepo().update({ id: user.id, platformId }, { externalId: next.externalId })
    }
    if (statusChanged || roleChanged) {
        await userService(log).update({
            id: user.id,
            platformId,
            status: statusChanged ? status : undefined,
            platformRole: roleChanged ? next.platformRole ?? undefined : undefined,
        })
    }
}

function assertRoleAllowed({ platformRole }: { platformRole: PlatformRole | null | undefined }): void {
    if (platformRole === PlatformRole.ADMIN) {
        throw scimErrors.badRequest({ detail: 'SCIM cannot grant the ADMIN platform role', scimType: 'invalidValue' })
    }
}

async function loadVerifiedSsoDomain({ log, platformId }: { log: FastifyBaseLogger, platformId: string }): Promise<string | null> {
    const platform = await platformService(log).getOneOrThrow(platformId)
    if (isNil(platform.ssoDomain) || platform.ssoDomainVerification?.status !== SsoDomainVerificationStatus.VERIFIED) {
        return null
    }
    return platform.ssoDomain.toLowerCase()
}

function emailDomainOf({ email }: { email: string }): string {
    return email.split('@')[1]?.toLowerCase() ?? ''
}

function assertEmailInSsoDomain({ email, ssoDomain }: { email: string, ssoDomain: string | null }): void {
    if (!isNil(ssoDomain) && emailDomainOf({ email }) !== ssoDomain) {
        throw scimErrors.badRequest({ detail: `userName must belong to the verified SSO domain ${ssoDomain}`, scimType: 'invalidValue' })
    }
}

async function usersOnOtherPlatforms({ identityId, platformId }: { identityId: string, platformId: string }): Promise<boolean> {
    const users = await userRepo().find({ where: { identityId }, select: { id: true, platformId: true } })
    return users.some((user) => !isNil(user.platformId) && user.platformId !== platformId)
}

async function assertIdentityReusable({ identityId, platformId, email, ssoDomain }: { identityId: string, platformId: string, email: string, ssoDomain: string | null }): Promise<void> {
    const sharedWithOtherPlatform = await usersOnOtherPlatforms({ identityId, platformId })
    const domainIsOwned = !isNil(ssoDomain) && emailDomainOf({ email }) === ssoDomain
    if (sharedWithOtherPlatform && !domainIsOwned) {
        throw scimErrors.conflict({ detail: `userName ${email} belongs to an account on another platform` })
    }
}

async function assertIdentityOwnedOnlyBy({ identityId, platformId }: { identityId: string, platformId: string }): Promise<void> {
    if (await usersOnOtherPlatforms({ identityId, platformId })) {
        throw scimErrors.badRequest({ detail: 'The name and userName cannot change because the account is shared with other platforms', scimType: 'mutability' })
    }
}

async function changeEmail({ log, identityId, email }: { log: FastifyBaseLogger, identityId: string, email: string }): Promise<void> {
    const existing = await userIdentityService(log).getIdentityByEmail(email)
    if (!isNil(existing) && existing.id !== identityId) {
        throw scimErrors.conflict({ detail: `userName ${email} already exists` })
    }
    await userIdentityRepository().update(identityId, { email, tokenVersion: nanoid() })
}

async function assertExternalIdAvailable({ log, platformId, externalId, userId }: { log: FastifyBaseLogger, platformId: string, externalId: string | null, userId: string | null }): Promise<void> {
    if (isNil(externalId)) {
        return
    }
    const holder = await userService(log).getByPlatformAndExternalId({ platformId, externalId })
    if (!isNil(holder) && holder.id !== userId) {
        throw scimErrors.conflict({ detail: `externalId ${externalId} already exists` })
    }
}

function toState({ user }: { user: UserWithIdentity }): ScimUserPatchState {
    return {
        userName: user.identity.email,
        userNameChanged: false,
        emailCandidate: null,
        externalId: user.externalId ?? null,
        firstName: user.identity.firstName,
        lastName: user.identity.lastName,
        active: user.status === UserStatus.ACTIVE,
        platformRole: null,
    }
}

function toResource({ user, baseUrl }: { user: UserWithIdentity, baseUrl: string }): ScimUserResourceBody {
    const { identity } = user
    return {
        schemas: [SCIM_USER_SCHEMA, SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA],
        id: user.id,
        ...(isNil(user.externalId) ? {} : { externalId: user.externalId }),
        userName: identity.email,
        name: {
            givenName: identity.firstName,
            familyName: identity.lastName,
            formatted: `${identity.firstName} ${identity.lastName}`.trim(),
        },
        emails: [{ value: identity.email, type: 'work', primary: true }],
        active: user.status === UserStatus.ACTIVE,
        [SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]: { platformRole: user.platformRole },
        meta: {
            resourceType: 'User',
            created: new Date(user.created).toISOString(),
            lastModified: new Date(user.updated).toISOString(),
            location: `${baseUrl}Users/${user.id}`,
        },
    }
}

function normalizeUserName({ userName }: { userName: string }): string {
    const email = userName.trim().toLowerCase()
    if (!email.includes('@')) {
        throw scimErrors.badRequest({ detail: 'userName must be an email address' })
    }
    return email
}

function fallbackFirstName({ email, formatted }: { email: string, formatted: string | undefined }): string {
    const fromFormatted = formatted?.trim().split(/\s+/)[0]
    return isNil(fromFormatted) || fromFormatted === '' ? email.split('@')[0] : fromFormatted
}

function clampCount({ count }: { count: number | undefined }): number {
    return Math.min(Math.max(count ?? DEFAULT_PAGE_SIZE, 0), MAX_PAGE_SIZE)
}

const LooseActive = z.union([z.boolean(), z.string()]).optional()

export const ScimCreateUserBody = CreateScimUserRequest.extend({
    schemas: z.array(z.string()).optional(),
    active: LooseActive,
})

export const ScimReplaceUserBody = ReplaceScimUserRequest.extend({
    schemas: z.array(z.string()).optional(),
    active: LooseActive,
})

export type ScimCreateUserBody = z.infer<typeof ScimCreateUserBody>
export type ScimReplaceUserBody = z.infer<typeof ScimReplaceUserBody>

type UserWithIdentity = NonNullable<Awaited<ReturnType<typeof findUserOrThrow>>>

type ScimUserResourceBody = Record<string, unknown>

type ScimUserListResult = {
    schemas: string[]
    totalResults: number
    startIndex: number
    itemsPerPage: number
    Resources: ScimUserResourceBody[]
}

type BaseUrlParams = {
    baseUrl: string
}

type IdParams = BaseUrlParams & {
    platformId: string
    id: string
}

type ListParams = BaseUrlParams & {
    platformId: string
    filter: string | undefined
    startIndex: number | undefined
    count: number | undefined
}

type CreateParams = BaseUrlParams & {
    platformId: string
    request: ScimCreateUserBody
}

type ReplaceParams = IdParams & {
    request: ScimReplaceUserBody
}

type PatchParams = IdParams & {
    operations: ScimPatchOperationInput[]
}

type PersistParams = {
    log: FastifyBaseLogger
    platformId: string
    user: UserWithIdentity
    next: ScimUserPatchState
}
