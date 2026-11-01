import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import { SCIM_ERROR_SCHEMA, ScimError } from '@activepieces/shared'
import { StatusCodes } from 'http-status-codes'

class ScimApiError extends ScimError {
    constructor({ status, detail, scimType }: ScimApiErrorParams) {
        super(status, detail)
        this.scimType = scimType
    }

    scimType: string | undefined
}

function badRequest({ detail, scimType }: { detail: string, scimType?: string }): ScimApiError {
    return new ScimApiError({ status: StatusCodes.BAD_REQUEST, detail, scimType: scimType ?? 'invalidValue' })
}

function notFound({ detail }: { detail: string }): ScimApiError {
    return new ScimApiError({ status: StatusCodes.NOT_FOUND, detail })
}

function conflict({ detail }: { detail: string }): ScimApiError {
    return new ScimApiError({ status: StatusCodes.CONFLICT, detail, scimType: 'uniqueness' })
}

function unauthorized({ detail }: { detail: string }): ScimApiError {
    return new ScimApiError({ status: StatusCodes.UNAUTHORIZED, detail })
}

function fromUnknown({ error }: { error: unknown }): ScimError {
    if (error instanceof ScimError) {
        return error
    }
    if (error instanceof ActivepiecesError) {
        if (error.error.code === ErrorCode.ENTITY_NOT_FOUND) {
            return notFound({ detail: 'Resource not found' })
        }
        if (error.error.code === ErrorCode.EXISTING_USER) {
            return conflict({ detail: 'User already exists' })
        }
        return badRequest({ detail: describeActivepiecesError({ error }) })
    }
    return new ScimApiError({ status: StatusCodes.INTERNAL_SERVER_ERROR, detail: 'Internal server error' })
}

function toBody({ error }: { error: ScimError }): Record<string, string | string[]> {
    const scimType = error instanceof ScimApiError ? error.scimType : undefined
    return {
        schemas: [SCIM_ERROR_SCHEMA],
        status: String(error.status),
        detail: error.detail,
        ...(scimType ? { scimType } : {}),
    }
}

function describeActivepiecesError({ error }: { error: ActivepiecesError }): string {
    const params: unknown = error.error.params
    if (typeof params === 'object' && params !== null && 'message' in params && typeof params.message === 'string') {
        return params.message
    }
    return error.error.code
}

export const scimErrors = {
    badRequest,
    notFound,
    conflict,
    unauthorized,
    fromUnknown,
    toBody,
}

type ScimApiErrorParams = {
    status: number
    detail: string
    scimType?: string
}
