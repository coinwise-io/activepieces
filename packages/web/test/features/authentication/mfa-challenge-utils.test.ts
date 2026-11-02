import { ErrorCode } from '@activepieces/core-utils';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { mfaChallengeUtils } from '@/features/authentication/utils/mfa-challenge-utils';

const authentication = {
  id: 'user-1',
  platformId: 'platform-1',
  projectId: 'project-1',
  token: 'jwt',
  verified: true,
};

function serverError(code: ErrorCode): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 410,
    statusText: 'Gone',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { code },
  });
}

describe('mfaChallengeUtils.resolveSignIn', () => {
  it('routes an MFA challenge to onChallenge and never authenticates', () => {
    const onChallenge = vi.fn();
    const onAuthenticated = vi.fn();
    const challenge = {
      mfaRequired: true as const,
      challengeToken: 'token',
      enrollmentRequired: false,
    };

    mfaChallengeUtils.resolveSignIn({
      response: challenge,
      onChallenge,
      onAuthenticated,
    });

    expect(onChallenge).toHaveBeenCalledWith(challenge);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('routes a normal session to onAuthenticated', () => {
    const onChallenge = vi.fn();
    const onAuthenticated = vi.fn();

    mfaChallengeUtils.resolveSignIn({
      response: authentication,
      onChallenge,
      onAuthenticated,
    });

    expect(onAuthenticated).toHaveBeenCalledWith(authentication);
    expect(onChallenge).not.toHaveBeenCalled();
  });
});

describe('mfaChallengeUtils.classifyError', () => {
  it('maps INVALID_OTP to invalid-code', () => {
    expect(
      mfaChallengeUtils.classifyError(serverError(ErrorCode.INVALID_OTP)),
    ).toBe('invalid-code');
  });

  it('maps MFA_CHALLENGE_EXPIRED to challenge-expired', () => {
    expect(
      mfaChallengeUtils.classifyError(
        serverError(ErrorCode.MFA_CHALLENGE_EXPIRED),
      ),
    ).toBe('challenge-expired');
  });

  it('treats anything else as unknown', () => {
    expect(mfaChallengeUtils.classifyError(new Error('boom'))).toBe('unknown');
    expect(
      mfaChallengeUtils.classifyError(serverError(ErrorCode.MFA_REQUIRED)),
    ).toBe('unknown');
  });
});

describe('mfaChallengeUtils.isAcceptableCode', () => {
  it('accepts a 6-digit authenticator code only in totp mode', () => {
    expect(
      mfaChallengeUtils.isAcceptableCode({ code: '123456', mode: 'totp' }),
    ).toBe(true);
    expect(
      mfaChallengeUtils.isAcceptableCode({ code: '12345', mode: 'totp' }),
    ).toBe(false);
    expect(
      mfaChallengeUtils.isAcceptableCode({ code: 'abcde-fghij', mode: 'totp' }),
    ).toBe(false);
  });

  it('accepts recovery codes with or without the dash in recovery mode', () => {
    expect(
      mfaChallengeUtils.isAcceptableCode({
        code: 'abcde-fghij',
        mode: 'recovery',
      }),
    ).toBe(true);
    expect(
      mfaChallengeUtils.isAcceptableCode({
        code: ' ABCDEFGHIJ ',
        mode: 'recovery',
      }),
    ).toBe(true);
    expect(
      mfaChallengeUtils.isAcceptableCode({ code: 'abc', mode: 'recovery' }),
    ).toBe(false);
  });
});
