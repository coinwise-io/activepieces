import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6
const SECRET_BYTES = 20
const ALLOWED_DRIFT_STEPS = 1

function generateSecret(): string {
    return base32Encode(randomBytes(SECRET_BYTES))
}

function codeAt({ secret, step }: CodeAtParams): string {
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(step))
    const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
    const offset = hmac[hmac.length - 1] & 0x0f
    const binary = hmac.readUInt32BE(offset) & 0x7fffffff
    return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

function stepAt({ nowMs }: { nowMs: number }): number {
    return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

function isTotpFormat(code: string): boolean {
    return new RegExp(`^\\d{${DIGITS}}$`).test(normalize(code))
}

function findMatchingStep({ secret, code, nowMs, lastUsedStep }: FindMatchingStepParams): number | null {
    const candidate = normalize(code)
    if (!isTotpFormat(candidate)) {
        return null
    }
    const current = stepAt({ nowMs })
    const steps = Array.from({ length: ALLOWED_DRIFT_STEPS * 2 + 1 }, (_, index) => current - ALLOWED_DRIFT_STEPS + index)
        .filter((step) => lastUsedStep === null || step > lastUsedStep)
    return steps.find((step) => constantTimeEquals({ left: codeAt({ secret, step }), right: candidate })) ?? null
}

function buildOtpauthUri({ secret, issuer, accountName }: BuildOtpauthUriParams): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`
    const query = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(STEP_SECONDS),
    })
    return `otpauth://totp/${label}?${query.toString()}`
}

function base32Encode(buffer: Buffer): string {
    let bits = 0
    let value = 0
    let output = ''
    for (const byte of buffer) {
        value = (value << 8) | byte
        bits += 8
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
            bits -= 5
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
    }
    return output
}

function base32Decode(input: string): Buffer {
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const char of input.replace(/=+$/, '').toUpperCase()) {
        const index = BASE32_ALPHABET.indexOf(char)
        if (index === -1) {
            throw new Error('Invalid base32 character')
        }
        value = (value << 5) | index
        bits += 5
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff)
            bits -= 8
        }
    }
    return Buffer.from(bytes)
}

function normalize(code: string): string {
    return code.replace(/\s+/g, '')
}

function constantTimeEquals({ left, right }: { left: string, right: string }): boolean {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const totp = {
    generateSecret,
    codeAt,
    stepAt,
    isTotpFormat,
    findMatchingStep,
    buildOtpauthUri,
    base32Encode,
    base32Decode,
}

type CodeAtParams = {
    secret: string
    step: number
}

type FindMatchingStepParams = {
    secret: string
    code: string
    nowMs: number
    lastUsedStep: number | null
}

type BuildOtpauthUriParams = {
    secret: string
    issuer: string
    accountName: string
}
