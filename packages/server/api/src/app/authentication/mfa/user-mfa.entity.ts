import { Platform, User } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'
import { EncryptedObject } from '../../helper/encryption'

export const UserMfaEntity = new EntitySchema<UserMfaSchema>({
    name: 'user_mfa',
    columns: {
        ...BaseColumnSchemaPart,
        userId: {
            ...ApIdSchema,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        secret: {
            type: 'jsonb',
            nullable: false,
        },
        lastUsedStep: {
            type: Number,
            nullable: true,
        },
        recoveryCodeHashes: {
            type: String,
            array: true,
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_user_mfa_user_id',
            columns: ['userId'],
            unique: true,
        },
        {
            name: 'idx_user_mfa_platform_id',
            columns: ['platformId'],
        },
    ],
    relations: {
        user: {
            type: 'many-to-one',
            target: 'user',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'userId',
                foreignKeyConstraintName: 'fk_user_mfa_user_id',
            },
        },
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                foreignKeyConstraintName: 'fk_user_mfa_platform_id',
            },
        },
    },
})

export type UserMfaSchema = {
    id: string
    created: string
    updated: string
    userId: string
    platformId: string
    secret: EncryptedObject
    lastUsedStep: number | null
    recoveryCodeHashes: string[]
    user: User
    platform: Platform
}
