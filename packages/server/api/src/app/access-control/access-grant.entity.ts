import { AccessGrant, Flow, Folder, Platform, Project, User } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'
import { UserGroupSchema } from '../identity-provisioning/user-group/user-group.entity'

export const AccessGrantEntity = new EntitySchema<AccessGrantSchema>({
    name: 'access_grant',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        folderId: {
            ...ApIdSchema,
            nullable: true,
        },
        flowId: {
            ...ApIdSchema,
            nullable: true,
        },
        userId: {
            ...ApIdSchema,
            nullable: true,
        },
        groupId: {
            ...ApIdSchema,
            nullable: true,
        },
        role: {
            type: String,
            nullable: false,
        },
        createdBy: {
            ...ApIdSchema,
            nullable: true,
        },
    },
    checks: [
        {
            name: 'chk_access_grant_single_principal',
            expression: '("userId" IS NULL) <> ("groupId" IS NULL)',
        },
    ],
    indices: [
        { name: 'idx_access_grant_platform_id', columns: ['platformId'] },
        { name: 'idx_access_grant_project_id', columns: ['projectId'] },
        { name: 'idx_access_grant_folder_id', columns: ['folderId'] },
        { name: 'idx_access_grant_flow_id', columns: ['flowId'] },
        { name: 'idx_access_grant_user_id', columns: ['userId'] },
        { name: 'idx_access_grant_group_id', columns: ['groupId'] },
        {
            name: 'idx_access_grant_unique_project_user',
            columns: ['projectId', 'userId', 'role'],
            unique: true,
            where: '"folderId" IS NULL AND "flowId" IS NULL AND "userId" IS NOT NULL',
        },
        {
            name: 'idx_access_grant_unique_project_group',
            columns: ['projectId', 'groupId', 'role'],
            unique: true,
            where: '"folderId" IS NULL AND "flowId" IS NULL AND "groupId" IS NOT NULL',
        },
        {
            name: 'idx_access_grant_unique_folder_user',
            columns: ['folderId', 'userId', 'role'],
            unique: true,
            where: '"folderId" IS NOT NULL AND "userId" IS NOT NULL',
        },
        {
            name: 'idx_access_grant_unique_folder_group',
            columns: ['folderId', 'groupId', 'role'],
            unique: true,
            where: '"folderId" IS NOT NULL AND "groupId" IS NOT NULL',
        },
        {
            name: 'idx_access_grant_unique_flow_user',
            columns: ['flowId', 'userId', 'role'],
            unique: true,
            where: '"flowId" IS NOT NULL AND "userId" IS NOT NULL',
        },
        {
            name: 'idx_access_grant_unique_flow_group',
            columns: ['flowId', 'groupId', 'role'],
            unique: true,
            where: '"flowId" IS NOT NULL AND "groupId" IS NOT NULL',
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
                foreignKeyConstraintName: 'fk_access_grant_platform_id',
            },
        },
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_access_grant_project_id',
            },
        },
        folder: {
            type: 'many-to-one',
            target: 'folder',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'folderId',
                foreignKeyConstraintName: 'fk_access_grant_folder_id',
            },
        },
        flow: {
            type: 'many-to-one',
            target: 'flow',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'flowId',
                foreignKeyConstraintName: 'fk_access_grant_flow_id',
            },
        },
        user: {
            type: 'many-to-one',
            target: 'user',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'userId',
                foreignKeyConstraintName: 'fk_access_grant_user_id',
            },
        },
        group: {
            type: 'many-to-one',
            target: 'user_group',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'groupId',
                foreignKeyConstraintName: 'fk_access_grant_group_id',
            },
        },
        creator: {
            type: 'many-to-one',
            target: 'user',
            onDelete: 'SET NULL',
            joinColumn: {
                name: 'createdBy',
                foreignKeyConstraintName: 'fk_access_grant_created_by',
            },
        },
    },
})

export type AccessGrantSchema = AccessGrant & {
    platform: Platform
    project: Project
    folder: Folder | null
    flow: Flow | null
    user: User | null
    group: UserGroupSchema | null
    creator: User | null
}
