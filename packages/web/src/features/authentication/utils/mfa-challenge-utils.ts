import { ErrorCode } from '@activepieces/core-utils';
import {
  AuthenticationResponse,
  MfaChallengeResponse,
  SignInResponse,
  mfaUtils,
} from '@activepieces/shared';
import { isAxiosError } from 'axios';

const TOTP_PATTERN = /^\d{6}$/;
const RECOVERY_CODE_PATTERN = /^[a-z0-9]{5}-?[a-z0-9]{5}$/i;

function resolveSignIn<T>({
  response,
  onChallenge,
  onAuthenticated,
}: {
  response: SignInResponse;
  onChallenge: (challenge: MfaChallengeResponse) => T;
  onAuthenticated: (authentication: AuthenticationResponse) => T;
}): T {
  if (mfaUtils.isMfaChallenge(response)) {
    return onChallenge(response);
  }
  return onAuthenticated(response);
}

function classifyError(error: unknown): MfaErrorKind {
  if (!isAxiosError(error)) {
    return 'unknown';
  }
  const code: unknown = error.response?.data?.code;
  if (code === ErrorCode.INVALID_OTP) {
    return 'invalid-code';
  }
  if (code === ErrorCode.MFA_CHALLENGE_EXPIRED) {
    return 'challenge-expired';
  }
  return 'unknown';
}

function isAcceptableCode({
  code,
  mode,
}: {
  code: string;
  mode: MfaCodeMode;
}): boolean {
  const trimmed = code.trim();
  return mode === 'totp'
    ? TOTP_PATTERN.test(trimmed)
    : RECOVERY_CODE_PATTERN.test(trimmed);
}

export const mfaChallengeUtils = {
  resolveSignIn,
  classifyError,
  isAcceptableCode,
};

export const MFA_TOTP_LENGTH = 6;
export type MfaErrorKind = 'invalid-code' | 'challenge-expired' | 'unknown';
export type MfaCodeMode = 'totp' | 'recovery';
