import {
  AuthenticationResponse,
  ConfirmMfaEnrollmentRequest,
  ConfirmMfaEnrollmentResponse,
  MfaCodeRequest,
  MfaEnrollmentSecret,
  MfaRecoveryCodesResponse,
  MfaStatus,
  StartMfaEnrollmentRequest,
  VerifyMfaChallengeRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mfaApi } from '@/features/authentication/api/mfa-api';
import { HttpError } from '@/lib/api';

const mfaKeys = {
  status: ['mfa-status'] as const,
  enrolledUsers: ['mfa-enrolled-users'] as const,
};

export const mfaHooks = {
  useStatus: () => {
    return useQuery<MfaStatus, HttpError>({
      queryKey: mfaKeys.status,
      queryFn: mfaApi.getStatus,
    });
  },
  useEnrolledUserIds: ({ enabled }: { enabled: boolean }) => {
    return useQuery<string[], HttpError>({
      queryKey: mfaKeys.enrolledUsers,
      queryFn: async () => {
        const { userIds } = await mfaApi.listEnrolledUsers();
        return userIds;
      },
      enabled,
      retry: false,
    });
  },
};

export const mfaMutations = {
  useVerifyChallenge: () => {
    return useMutation<
      AuthenticationResponse,
      HttpError,
      VerifyMfaChallengeRequest
    >({
      mutationFn: mfaApi.verifyChallenge,
    });
  },
  useStartEnrollment: () => {
    return useMutation<
      MfaEnrollmentSecret,
      HttpError,
      StartMfaEnrollmentRequest
    >({ mutationFn: mfaApi.startEnrollment });
  },
  useConfirmEnrollment: () => {
    return useMutation<
      ConfirmMfaEnrollmentResponse,
      HttpError,
      ConfirmMfaEnrollmentRequest
    >({ mutationFn: mfaApi.confirmEnrollment });
  },
  useStartSetup: () => {
    return useMutation<MfaEnrollmentSecret, HttpError, void>({
      mutationFn: mfaApi.startSetup,
    });
  },
  useConfirmSetup: () => {
    const queryClient = useQueryClient();
    return useMutation<MfaRecoveryCodesResponse, HttpError, MfaCodeRequest>({
      mutationFn: mfaApi.confirmSetup,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: mfaKeys.status }),
    });
  },
  useRegenerateRecoveryCodes: () => {
    const queryClient = useQueryClient();
    return useMutation<MfaRecoveryCodesResponse, HttpError, MfaCodeRequest>({
      mutationFn: mfaApi.regenerateRecoveryCodes,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: mfaKeys.status }),
    });
  },
  useDisable: () => {
    const queryClient = useQueryClient();
    return useMutation<void, HttpError, MfaCodeRequest>({
      mutationFn: mfaApi.disable,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: mfaKeys.status }),
    });
  },
  useResetUser: ({ onSuccess }: { onSuccess: () => void }) => {
    const queryClient = useQueryClient();
    return useMutation<void, HttpError, string>({
      mutationFn: mfaApi.resetUser,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: mfaKeys.enrolledUsers });
        onSuccess();
      },
    });
  },
};
