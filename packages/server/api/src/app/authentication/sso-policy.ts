import { isNil } from '@activepieces/core-utils'
import { Platform, PlatformWithoutSensitiveData, SsoDomainVerificationStatus } from '@activepieces/shared'

function isSsoActive({ platform }: { platform: SsoPlatform }): boolean {
    return !isNil(platform.federatedAuthProviders?.saml)
        && !isNil(platform.ssoDomain)
        && platform.ssoDomainVerification?.status === SsoDomainVerificationStatus.VERIFIED
}

function isInSsoDomain({ platform, email }: { platform: SsoPlatform, email: string }): boolean {
    if (!isSsoActive({ platform })) {
        return false
    }
    return emailDomain({ email }) === platform.ssoDomain?.toLowerCase()
}

function emailDomain({ email }: { email: string }): string {
    return email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase()
}

export const ssoPolicy = {
    isSsoActive,
    isInSsoDomain,
    emailDomain,
}

type SsoPlatform = Pick<Platform | PlatformWithoutSensitiveData, 'federatedAuthProviders' | 'ssoDomain' | 'ssoDomainVerification'>
