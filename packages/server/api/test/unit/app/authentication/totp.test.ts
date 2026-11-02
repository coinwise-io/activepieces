import { totp } from '../../../../src/app/authentication/mfa/totp'

const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'))

describe('totp', () => {
    it.each([
        [59, '287082'],
        [1111111109, '081804'],
        [1111111111, '050471'],
        [1234567890, '005924'],
        [2000000000, '279037'],
        [20000000000, '353130'],
    ])('matches the RFC 6238 SHA-1 vector at %i seconds', (seconds, expected) => {
        const step = totp.stepAt({ nowMs: seconds * 1000 })
        expect(totp.codeAt({ secret: RFC_SECRET, step })).toBe(expected)
    })

    it('round-trips base32', () => {
        const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
        expect(totp.base32Decode(totp.base32Encode(bytes))).toEqual(bytes)
        expect(totp.base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    })

    it('generates a 160-bit base32 secret', () => {
        const secret = totp.generateSecret()
        expect(secret).toMatch(/^[A-Z2-7]{32}$/)
        expect(totp.base32Decode(secret)).toHaveLength(20)
    })

    it('accepts one step of drift each way and nothing further', () => {
        const nowMs = 1_700_000_000_000
        const step = totp.stepAt({ nowMs })
        const secret = totp.generateSecret()
        for (const offset of [-1, 0, 1]) {
            const code = totp.codeAt({ secret, step: step + offset })
            expect(totp.findMatchingStep({ secret, code, nowMs, lastUsedStep: null })).toBe(step + offset)
        }
        for (const offset of [-2, 2]) {
            const code = totp.codeAt({ secret, step: step + offset })
            const matched = totp.findMatchingStep({ secret, code, nowMs, lastUsedStep: null })
            expect(matched === step + offset).toBe(false)
        }
    })

    it('refuses a step that is not newer than the last accepted one', () => {
        const nowMs = 1_700_000_000_000
        const step = totp.stepAt({ nowMs })
        const secret = totp.generateSecret()
        const code = totp.codeAt({ secret, step })
        expect(totp.findMatchingStep({ secret, code, nowMs, lastUsedStep: step })).toBeNull()
        expect(totp.findMatchingStep({ secret, code, nowMs, lastUsedStep: step - 1 })).toBe(step)
    })

    it('rejects codes that are not six digits', () => {
        const secret = totp.generateSecret()
        expect(totp.findMatchingStep({ secret, code: 'abcdef', nowMs: Date.now(), lastUsedStep: null })).toBeNull()
        expect(totp.findMatchingStep({ secret, code: '12345', nowMs: Date.now(), lastUsedStep: null })).toBeNull()
        expect(totp.isTotpFormat('123 456')).toBe(true)
    })

    it('builds an otpauth URI with the issuer and account', () => {
        const uri = totp.buildOtpauthUri({ secret: 'ABC', issuer: 'Acme Corp', accountName: 'a@b.com' })
        expect(uri).toBe('otpauth://totp/Acme%20Corp:a%40b.com?secret=ABC&issuer=Acme+Corp&algorithm=SHA1&digits=6&period=30')
    })
})
