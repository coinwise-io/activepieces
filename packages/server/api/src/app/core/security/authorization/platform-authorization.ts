import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { PlatformRole, PlatformWithoutSensitiveData, PrincipalType } from '@activepieces/shared'
import { FastifyRequest } from 'fastify'
import { platformService } from '../../../platform/platform.service'
import { userService } from '../../../user/user-service'

export async function assertPlatformAdmin(request: FastifyRequest): Promise<void> {
    const principal = request.principal
    if (principal.type === PrincipalType.SERVICE) {
        return
    }
    if (principal.type !== PrincipalType.USER) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'You are unauthenticated and cannot access this resource',
            },
        })
    }
    const user = await userService(request.log).getOneOrFail({ id: principal.id })
    if (user.platformRole !== PlatformRole.ADMIN || user.platformId !== principal.platform.id) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User is not owner of the platform',
            },
        })
    }
}

export async function assertPlatformFeatureEnabled({ request, isEnabled }: AssertPlatformFeatureEnabledParams): Promise<void> {
    const platformId = 'platform' in request.principal ? request.principal.platform.id : null
    if (isNil(platformId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Platform ID is required',
            },
        })
    }
    const platform = await platformService(request.log).getOneWithPlanOrThrow(platformId)
    if (!isEnabled(platform)) {
        throw featureDisabledError()
    }
}

export function featureDisabledError(): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.FEATURE_DISABLED,
        params: {
            message: 'Feature is disabled',
        },
    })
}

type AssertPlatformFeatureEnabledParams = {
    request: FastifyRequest
    isEnabled: (platform: PlatformWithoutSensitiveData) => boolean
}
