import { randomBytes } from 'crypto'
import { ActivepiecesError, apId, ErrorCode, isNil } from '@activepieces/core-utils'
import { cryptoUtils } from '@activepieces/server-utils'
import { CreateScimTokenResponse, ScimToken } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../../core/db/repo-factory'
import { rejectedPromiseHandler } from '../../helper/promise-handler'
import { ScimTokenEntity, ScimTokenSchema } from './scim-token.entity'

const TOKEN_PREFIX = 'scim_'
const TOKEN_BYTES = 32

const scimTokenRepo = repoFactory(ScimTokenEntity)

export const scimTokenService = (log: FastifyBaseLogger) => ({
    async create({ platformId, displayName }: CreateParams): Promise<CreateScimTokenResponse> {
        const token = generateToken()
        const saved = await scimTokenRepo().save({
            id: apId(),
            platformId,
            displayName,
            tokenHash: cryptoUtils.hashSHA256(token),
            lastUsedAt: null,
        })
        const created = await scimTokenRepo().findOneByOrFail({ id: saved.id, platformId })
        return { ...toDto({ entity: created }), token }
    },
    async list({ platformId }: PlatformParams): Promise<ScimToken[]> {
        const tokens = await scimTokenRepo().find({ where: { platformId }, order: { created: 'DESC' } })
        return tokens.map((entity) => toDto({ entity }))
    },
    async delete({ platformId, id }: DeleteParams): Promise<void> {
        const result = await scimTokenRepo().delete({ id, platformId })
        if (result.affected === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'scim_token', entityId: id },
            })
        }
    },
    async authenticate({ token }: { token: string }): Promise<{ platformId: string } | null> {
        if (!token.startsWith(TOKEN_PREFIX)) {
            return null
        }
        const entity = await scimTokenRepo().findOneBy({ tokenHash: cryptoUtils.hashSHA256(token) })
        if (isNil(entity)) {
            return null
        }
        rejectedPromiseHandler(scimTokenRepo().update({ id: entity.id }, { lastUsedAt: new Date() }), log)
        return { platformId: entity.platformId }
    },
})

function generateToken(): string {
    return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

function toDto({ entity }: { entity: ScimTokenSchema }): ScimToken {
    return {
        id: entity.id,
        created: entity.created,
        updated: entity.updated,
        platformId: entity.platformId,
        displayName: entity.displayName,
        lastUsedAt: isNil(entity.lastUsedAt) ? null : new Date(entity.lastUsedAt).toISOString(),
    }
}

type PlatformParams = {
    platformId: string
}

type CreateParams = PlatformParams & {
    displayName: string
}

type DeleteParams = PlatformParams & {
    id: string
}
