import { UserGroupWithMembers } from '@activepieces/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { UserGroupMemberEntity } from './user-group-member.entity'
import { UserGroupEntity } from './user-group.entity'

export const userGroupRepo = repoFactory(UserGroupEntity)
export const userGroupMemberRepo = repoFactory(UserGroupMemberEntity)

export const userGroupService = {
    async list({ platformId }: { platformId: string }): Promise<UserGroupWithMembers[]> {
        const groups = await userGroupRepo().find({ where: { platformId }, order: { displayName: 'ASC' } })
        if (groups.length === 0) {
            return []
        }
        const rows = await userGroupMemberRepo()
            .createQueryBuilder('member')
            .innerJoin('member.group', 'grp')
            .innerJoin('member.user', 'usr')
            .innerJoin('usr.identity', 'identity')
            .select('member.groupId', 'groupId')
            .addSelect('usr.id', 'id')
            .addSelect('identity.email', 'email')
            .addSelect('identity.firstName', 'firstName')
            .addSelect('identity.lastName', 'lastName')
            .where('grp.platformId = :platformId', { platformId })
            .orderBy('identity.email', 'ASC')
            .getRawMany<MemberRow>()
        const membersByGroup = rows.reduce((acc, row) => {
            const existing = acc.get(row.groupId) ?? []
            return acc.set(row.groupId, [...existing, row])
        }, new Map<string, MemberRow[]>())
        return groups.map((group) => ({
            id: group.id,
            created: group.created,
            updated: group.updated,
            platformId: group.platformId,
            displayName: group.displayName,
            externalId: group.externalId,
            members: (membersByGroup.get(group.id) ?? []).map((row) => ({
                id: row.id,
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName,
            })),
        }))
    },
}

type MemberRow = {
    groupId: string
    id: string
    email: string
    firstName: string
    lastName: string
}
