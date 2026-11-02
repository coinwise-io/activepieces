import { Platform } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'

export const UserGroupEntity = new EntitySchema<UserGroupSchema>({
    name: 'user_group',
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
        externalId: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_user_group_platform_id',
            columns: ['platformId'],
        },
        {
            name: 'idx_user_group_platform_id_display_name',
            columns: ['platformId', 'displayName'],
            unique: true,
        },
        {
            name: 'idx_user_group_platform_id_external_id',
            columns: ['platformId', 'externalId'],
            unique: true,
            where: '"externalId" IS NOT NULL',
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
                foreignKeyConstraintName: 'fk_user_group_platform_id',
            },
        },
    },
})

export type UserGroupSchema = {
    id: string
    created: string
    updated: string
    platformId: string
    displayName: string
    externalId: string | null
    platform: Platform
}
