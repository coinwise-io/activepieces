import { Platform } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'

export const ScimTokenEntity = new EntitySchema<ScimTokenSchema>({
    name: 'scim_token',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        displayName: {
            type: String,
            nullable: false,
        },
        tokenHash: {
            type: String,
            nullable: false,
        },
        lastUsedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_scim_token_platform_id',
            columns: ['platformId'],
        },
        {
            name: 'idx_scim_token_token_hash',
            columns: ['tokenHash'],
            unique: true,
        },
    ],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                foreignKeyConstraintName: 'fk_scim_token_platform_id',
            },
        },
    },
})

export type ScimTokenSchema = {
    id: string
    created: string
    updated: string
    platformId: string
    displayName: string
    tokenHash: string
    lastUsedAt: Date | null
    platform: Platform
}
