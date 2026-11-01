import { SsoDomainVerificationRecordType, SsoDomainVerificationStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { authenticationUtils } from '../../../../src/app/authentication/authentication-utils'
import { authenticationService } from '../../../../src/app/authentication/authentication.service'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let mockLog: FastifyBaseLogger

beforeAll(async () => {
    const app = await setupTestEnvironment()
    mockLog = app.log
})

afterEach(() => {
    delete process.env.AP_GOOGLE_CLIENT_ID
    delete process.env.AP_GOOGLE_CLIENT_SECRET
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Sign-in discovery', () => {
    it('returns domainOwned: false', async () => {
        await expect(authenticationService(mockLog).discoverSignInMethods({ domain: 'community.example.com' })).resolves.toEqual({ domainOwned: false })
    })

    it('follows the platform settings on CE', () => {
        process.env.AP_GOOGLE_CLIENT_ID = 'test-google-client-id'
        process.env.AP_GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
        const methods = authenticationUtils(mockLog).getSignInMethods({
            platform: { emailAuthEnabled: false, googleAuthEnabled: true, federatedAuthProviders: { saml: {} } },
        })
        expect(methods).toEqual({ email: false, google: true, sso: false })
    })

    it('reports sso only when saml is configured and the domain is verified', () => {
        const methods = authenticationUtils(mockLog).getSignInMethods({
            platform: {
                emailAuthEnabled: true,
                googleAuthEnabled: false,
                federatedAuthProviders: { saml: {} },
                ssoDomainVerification: {
                    status: SsoDomainVerificationStatus.VERIFIED,
                    record: { type: SsoDomainVerificationRecordType.TXT, name: '_ap-sso-verification.acme.com', value: 'ap-sso-verification=x' },
                    createdAt: new Date().toISOString(),
                },
            },
        })
        expect(methods.sso).toBe(true)
    })
})
