import { User } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../../database/database-common'
import { UserGroupSchema } from './user-group.entity'

export const UserGroupMemberEntity = new EntitySchema<UserGroupMemberSchema>({
    name: 'user_group_member',
    columns: {
        id: BaseColumnSchemaPart.id,
        created: BaseColumnSchemaPart.created,
        groupId: {
            ...ApIdSchema,
            nullable: false,
        },
        userId: {
            ...ApIdSchema,
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_user_group_member_group_id_user_id',
            columns: ['groupId', 'userId'],
            unique: true,
        },
        {
            name: 'idx_user_group_member_user_id',
            columns: ['userId'],
        },
    ],
    relations: {
        group: {
            type: 'many-to-one',
            target: 'user_group',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'groupId',
                foreignKeyConstraintName: 'fk_user_group_member_group_id',
            },
        },
        user: {
            type: 'many-to-one',
            target: 'user',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'userId',
                foreignKeyConstraintName: 'fk_user_group_member_user_id',
            },
        },
    },
})

export type UserGroupMemberSchema = {
    id: string
    created: string
    groupId: string
    userId: string
    group: UserGroupSchema
    user: User
}
