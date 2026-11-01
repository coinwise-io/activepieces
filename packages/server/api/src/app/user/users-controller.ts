import { ActivepiecesError, ApId, ErrorCode, isNil } from '@activepieces/core-utils'
import { AP_MAXIMUM_PROFILE_PICTURE_SIZE, FileType, PrincipalType, PROFILE_PICTURE_ALLOWED_TYPES, SERVICE_KEY_SECURITY_OPENAPI, UpdateMeRequestBody, UpdateMeResponse, UserIdentity, UserWithMetaInformation } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { userIdentityService } from '../authentication/user-identity/user-identity-service'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { fileService } from '../file/file.service'
import { attachMultipartFieldsToBody } from '../helper/multipart-body'
import { userService } from './user-service'

export const usersController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:id', GetUserByIdRequest, async (req): Promise<UserWithMetaInformation> => {
        return userService(req.log).getOneByIdAndPlatformIdOrThrow({
            id: req.params.id,
            platformId: req.principal.platform.id,
        })
    })

    app.post('/me', UpdateMeRequest, async (req): Promise<UpdateMeResponse> => {
        const user = await userService(req.log).getOneOrFail({ id: req.principal.id })
        const imageUrl = await fileService(req.log).uploadPublicAsset({
            file: req.body.profilePicture,
            type: FileType.USER_PROFILE_PICTURE,
            platformId: req.principal.platform.id,
            allowedMimeTypes: PROFILE_PICTURE_ALLOWED_TYPES,
            maxFileSizeInBytes: AP_MAXIMUM_PROFILE_PICTURE_SIZE,
            metadata: { userId: user.id },
        })
        if (!isNil(imageUrl)) {
            await userIdentityService(req.log).update(user.identityId, { imageUrl })
        }
        const identity = await userIdentityService(req.log).getOneOrFail({ id: user.identityId })
        return toUpdateMeResponse(identity)
    })

    app.delete('/me/profile-picture', DeleteProfilePictureRequest, async (req) => {
        const user = await userService(req.log).getOneOrFail({ id: req.principal.id })
        const identity = await userIdentityService(req.log).getOneOrFail({ id: user.identityId })
        if (isNil(identity.imageUrl)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: 'User has no profile picture',
                },
            })
        }
        await userIdentityService(req.log).update(user.identityId, { imageUrl: null })
        return { success: true }
    })
}

function toUpdateMeResponse(identity: UserIdentity): UpdateMeResponse {
    return {
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        trackEvents: identity.trackEvents,
        newsLetter: identity.newsLetter,
        imageUrl: identity.imageUrl,
    }
}

const GetUserByIdRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['users'],
        description: 'Get a user by id',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: UserWithMetaInformation,
        },
    },
}

const UpdateMeRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
    preValidation: attachMultipartFieldsToBody,
    schema: {
        consumes: ['multipart/form-data'],
        body: UpdateMeRequestBody,
        response: {
            [StatusCodes.OK]: UpdateMeResponse,
        },
    },
}

const DeleteProfilePictureRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
    schema: {
        response: {
            [StatusCodes.OK]: z.object({
                success: z.boolean(),
            }),
        },
    },
}
