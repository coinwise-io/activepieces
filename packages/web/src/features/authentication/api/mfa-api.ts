import {
  AuthenticationResponse,
  ConfirmMfaEnrollmentRequest,
  ConfirmMfaEnrollmentResponse,
  ListMfaEnrolledUsersResponse,
  MfaCodeRequest,
  MfaEnrollmentSecret,
  MfaRecoveryCodesResponse,
  MfaStatus,
  StartMfaEnrollmentRequest,
  VerifyMfaChallengeRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const mfaApi = {
  verifyChallenge(request: VerifyMfaChallengeRequest) {
    return api.post<AuthenticationResponse>(
      '/v1/authentication/mfa/verify',
      request,
    );
  },
  startEnrollment(request: StartMfaEnrollmentRequest) {
    return api.post<MfaEnrollmentSecret>(
      '/v1/authentication/mfa/enroll',
      request,
    );
  },
  confirmEnrollment(request: ConfirmMfaEnrollmentRequest) {
    return api.post<ConfirmMfaEnrollmentResponse>(
      '/v1/authentication/mfa/enroll/confirm',
      request,
    );
  },
  getStatus() {
    return api.get<MfaStatus>('/v1/authentication/mfa/status');
  },
  startSetup() {
    return api.post<MfaEnrollmentSecret>('/v1/authentication/mfa/setup');
  },
  confirmSetup(request: MfaCodeRequest) {
    return api.post<MfaRecoveryCodesResponse>(
      '/v1/authentication/mfa/setup/confirm',
      request,
    );
  },
  regenerateRecoveryCodes(request: MfaCodeRequest) {
    return api.post<MfaRecoveryCodesResponse>(
      '/v1/authentication/mfa/recovery-codes',
      request,
    );
  },
  disable(request: MfaCodeRequest) {
    return api.post<void>('/v1/authentication/mfa/disable', request);
  },
  listEnrolledUsers() {
    return api.get<ListMfaEnrolledUsersResponse>(
      '/v1/authentication/mfa/users',
    );
  },
  resetUser(userId: string) {
    return api.delete<void>(`/v1/authentication/mfa/users/${userId}`);
  },
};
