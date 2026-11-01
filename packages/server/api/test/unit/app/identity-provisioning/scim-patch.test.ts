import { PlatformRole } from '@activepieces/shared'
import { ScimGroupPatchState, scimPatchUtils, ScimUserPatchState } from '../../../../src/app/identity-provisioning/scim/scim-patch'

const userState: ScimUserPatchState = {
    userName: 'jane@example.com',
    userNameChanged: false,
    emailCandidate: null,
    externalId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    active: true,
    platformRole: null,
}

const groupState: ScimGroupPatchState = {
    displayName: 'Eng',
    externalId: null,
    memberIds: ['u1', 'u2'],
}

describe('scimPatchUtils.applyUserPatch', () => {
    it('applies a pathless replace with an object value', () => {
        const result = scimPatchUtils.applyUserPatch({
            operations: [{ op: 'replace', value: { active: false, name: { givenName: 'A' }, externalId: 'x' } }],
            state: userState,
        })

        expect(result).toMatchObject({ active: false, firstName: 'A', lastName: 'Doe', externalId: 'x' })
    })

    it('accepts boolean strings and any op casing', () => {
        const off = scimPatchUtils.applyUserPatch({ operations: [{ op: 'Replace', path: 'active', value: 'False' }], state: userState })
        const on = scimPatchUtils.applyUserPatch({ operations: [{ op: 'REPLACE', path: 'active', value: 'True' }], state: off })

        expect(off.active).toBe(false)
        expect(on.active).toBe(true)
    })

    it('rejects an invalid boolean and an unsupported op', () => {
        expect(() => scimPatchUtils.applyUserPatch({ operations: [{ op: 'replace', path: 'active', value: 'nope' }], state: userState })).toThrow()
        expect(() => scimPatchUtils.applyUserPatch({ operations: [{ op: 'move', path: 'active', value: true }], state: userState })).toThrow()
    })

    it('handles name sub paths', () => {
        const result = scimPatchUtils.applyUserPatch({
            operations: [
                { op: 'replace', path: 'name.givenName', value: 'Z' },
                { op: 'replace', path: 'name.familyName', value: 'Q' },
            ],
            state: userState,
        })

        expect(result).toMatchObject({ firstName: 'Z', lastName: 'Q' })
    })

    it('prefers userName over emails when both change', () => {
        const result = scimPatchUtils.applyUserPatch({
            operations: [
                { op: 'replace', path: 'userName', value: 'New@Example.com' },
                { op: 'replace', path: 'emails[type eq "work"].value', value: 'other@example.com' },
            ],
            state: userState,
        })

        expect(scimPatchUtils.resolveEmail({ state: result })).toBe('new@example.com')
    })

    it('uses the primary email of an emails value', () => {
        const result = scimPatchUtils.applyUserPatch({
            operations: [{ op: 'replace', value: { emails: [{ value: 'a@example.com', type: 'work' }, { value: 'b@example.com', primary: 'true' }] } }],
            state: userState,
        })

        expect(scimPatchUtils.resolveEmail({ state: result })).toBe('b@example.com')
    })

    it('clears externalId on remove and reads platformRole from the extension', () => {
        const withExternal = { ...userState, externalId: 'x' }
        const cleared = scimPatchUtils.applyUserPatch({ operations: [{ op: 'remove', path: 'externalId' }], state: withExternal })
        const promoted = scimPatchUtils.applyUserPatch({
            operations: [{ op: 'replace', value: { 'urn:ietf:params:scim:schemas:activepieces:1.0:CustomUserAttributes': { platformRole: 'ADMIN' } } }],
            state: userState,
        })

        expect(cleared.externalId).toBeNull()
        expect(promoted.platformRole).toBe(PlatformRole.ADMIN)
    })

    it('ignores unknown attributes', () => {
        const result = scimPatchUtils.applyUserPatch({ operations: [{ op: 'replace', path: 'title', value: 'CEO' }], state: userState })

        expect(result).toEqual(userState)
    })

    it('does not mutate the input state', () => {
        const snapshot = structuredClone(userState)

        scimPatchUtils.applyUserPatch({ operations: [{ op: 'replace', value: { active: false } }], state: userState })

        expect(userState).toEqual(snapshot)
    })
})

describe('scimPatchUtils.applyGroupPatch', () => {
    it('adds members without duplicates', () => {
        const result = scimPatchUtils.applyGroupPatch({
            operations: [{ op: 'Add', path: 'members', value: [{ value: 'u2' }, { value: 'u3' }] }],
            state: groupState,
        })

        expect(result.memberIds).toEqual(['u1', 'u2', 'u3'])
    })

    it('removes by filter path, by value array and entirely', () => {
        const byFilter = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'remove', path: 'members[value eq "u1"]' }], state: groupState })
        const byValue = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }], state: groupState })
        const all = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'remove', path: 'members' }], state: groupState })

        expect(byFilter.memberIds).toEqual(['u2'])
        expect(byValue.memberIds).toEqual(['u1'])
        expect(all.memberIds).toEqual([])
    })

    it('replaces members and displayName with and without a path', () => {
        const members = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'replace', path: 'members', value: [{ value: 'u9' }] }], state: groupState })
        const withPath = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'replace', path: 'displayName', value: 'Ops' }], state: groupState })
        const noPath = scimPatchUtils.applyGroupPatch({ operations: [{ op: 'replace', value: { displayName: 'Sec', members: [{ value: 'u5' }] } }], state: groupState })

        expect(members.memberIds).toEqual(['u9'])
        expect(withPath.displayName).toBe('Ops')
        expect(noPath).toMatchObject({ displayName: 'Sec', memberIds: ['u5'] })
    })

    it('rejects removing displayName and malformed members', () => {
        expect(() => scimPatchUtils.applyGroupPatch({ operations: [{ op: 'remove', path: 'displayName' }], state: groupState })).toThrow()
        expect(() => scimPatchUtils.applyGroupPatch({ operations: [{ op: 'add', path: 'members', value: [{ id: 'u1' }] }], state: groupState })).toThrow()
    })
})
