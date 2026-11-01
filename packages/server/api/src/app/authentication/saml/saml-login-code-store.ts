import { randomBytes } from 'node:crypto'
import { AuthenticationResponse } from '@activepieces/shared'
import { z } from 'zod'
import { samlTransientStore } from './saml-transient-store'

async function issue({ response, nonce }: IssueParams): Promise<string> {
    const code = randomBytes(CODE_BYTES).toString('base64url')
    await samlTransientStore.put({
        key: keyFor({ code }),
        value: { response, nonce },
        ttlSeconds: CODE_TTL_SECONDS,
    })
    return code
}

async function claim({ code }: ClaimParams): Promise<IssuedLogin | null> {
    return samlTransientStore.take({ key: keyFor({ code }), schema: IssuedLoginSchema })
}

function keyFor({ code }: ClaimParams): string {
    return `saml_login_code:${code}`
}

const CODE_BYTES = 32
const CODE_TTL_SECONDS = 60

const IssuedLoginSchema = z.object({
    response: AuthenticationResponse,
    nonce: z.string(),
})

export const samlLoginCodeStore = {
    issue,
    claim,
}

type IssuedLogin = z.infer<typeof IssuedLoginSchema>

type IssueParams = {
    response: AuthenticationResponse
    nonce: string
}

type ClaimParams = {
    code: string
}
