import { resolveTxt } from 'node:dns/promises'
import { tryCatch } from '@activepieces/core-utils'

async function lookup({ name }: LookupParams): Promise<string[]> {
    const { data, error } = await tryCatch(() => resolveTxt(name))
    if (error) {
        return []
    }
    return data.map((chunks) => chunks.join(''))
}

export const dnsTxtResolver = {
    lookup,
}

type LookupParams = {
    name: string
}
