import { isNil } from '@activepieces/core-utils';
import {
  AuthenticationResponse,
  ConfirmMfaEnrollmentResponse,
  MfaChallengeResponse,
  MfaEnrollmentSecret,
} from '@activepieces/shared';
import { t } from 'i18next';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { mfaMutations } from '@/features/authentication/hooks/mfa-hooks';
import { mfaChallengeUtils } from '@/features/authentication/utils/mfa-challenge-utils';

import { MfaCodeForm } from './mfa-code-form';
import { MfaEnrollmentSecretPanel } from './mfa-enrollment-secret';
import { MfaRecoveryCodesPanel } from './mfa-recovery-codes';

function MfaChallenge({
  challenge,
  onAuthenticated,
  onBack,
}: MfaChallengeProps) {
  const [expired, setExpired] = useState(false);

  if (expired) {
    return <ExpiredNotice onBack={onBack} />;
  }

  return (
    <div className="grid gap-5" data-testid="mfa-challenge">
      <BackButton onBack={onBack} />
      {challenge.enrollmentRequired ? (
        <EnrollmentFlow
          challengeToken={challenge.challengeToken}
          onAuthenticated={onAuthenticated}
          onChallengeExpired={() => setExpired(true)}
        />
      ) : (
        <VerifyStep
          challengeToken={challenge.challengeToken}
          onAuthenticated={onAuthenticated}
          onChallengeExpired={() => setExpired(true)}
        />
      )}
    </div>
  );
}

function VerifyStep({
  challengeToken,
  onAuthenticated,
  onChallengeExpired,
}: StepProps) {
  const { mutateAsync: verify } = mfaMutations.useVerifyChallenge();

  return (
    <>
      <StepHeading
        title={t('Two-factor authentication')}
        description={t('Enter the 6-digit code from your authenticator app.')}
      />
      <MfaCodeForm
        submitLabel={t('Verify')}
        allowRecoveryCode={true}
        onChallengeExpired={onChallengeExpired}
        submit={async (code) => {
          const authentication = await verify({ challengeToken, code });
          onAuthenticated(authentication);
        }}
      />
    </>
  );
}

function EnrollmentFlow({
  challengeToken,
  onAuthenticated,
  onChallengeExpired,
}: StepProps) {
  const [enrollment, setEnrollment] = useState<MfaEnrollmentSecret | null>(
    null,
  );
  const [confirmed, setConfirmed] =
    useState<ConfirmMfaEnrollmentResponse | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const { mutate: startEnrollment, isPending: isStarting } =
    mfaMutations.useStartEnrollment();
  const { mutateAsync: confirmEnrollment } =
    mfaMutations.useConfirmEnrollment();

  const handleStart = () => {
    setStartFailed(false);
    startEnrollment(
      { challengeToken },
      {
        onSuccess: setEnrollment,
        onError: (error) => {
          if (mfaChallengeUtils.classifyError(error) === 'challenge-expired') {
            onChallengeExpired();
            return;
          }
          setStartFailed(true);
        },
      },
    );
  };

  if (!isNil(confirmed)) {
    return (
      <>
        <StepHeading
          title={t('Save your recovery codes')}
          description={t(
            'Use a recovery code to sign in if you lose access to your authenticator app.',
          )}
        />
        <MfaRecoveryCodesPanel recoveryCodes={confirmed.recoveryCodes} />
        <Button
          onClick={() => onAuthenticated(confirmed.authentication)}
          data-testid="mfa-recovery-saved"
        >
          {t('I saved my recovery codes')}
        </Button>
      </>
    );
  }

  if (isNil(enrollment)) {
    return (
      <>
        <StepHeading
          title={t('Set up two-factor authentication')}
          description={t(
            'Your organization requires a second step when you sign in with a password. Set up an authenticator app to continue.',
          )}
        />
        {startFailed && (
          <p className="text-sm text-danger-11">
            {t('Something went wrong, please try again later')}
          </p>
        )}
        <Button
          onClick={handleStart}
          loading={isStarting}
          data-testid="mfa-begin-setup"
        >
          {t('Begin setup')}
        </Button>
      </>
    );
  }

  return (
    <>
      <StepHeading title={t('Set up two-factor authentication')} />
      <MfaEnrollmentSecretPanel enrollment={enrollment} />
      <p className="text-sm text-gray-11">
        {t('Then enter the 6-digit code shown in your app.')}
      </p>
      <MfaCodeForm
        submitLabel={t('Confirm')}
        allowRecoveryCode={false}
        onChallengeExpired={onChallengeExpired}
        submit={async (code) => {
          const response = await confirmEnrollment({ challengeToken, code });
          setConfirmed(response);
        }}
      />
    </>
  );
}

function ExpiredNotice({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid gap-4" data-testid="mfa-expired">
      <StepHeading
        title={t('Sign-in expired')}
        description={t('Your sign-in expired. Please start again.')}
      />
      <Button onClick={onBack}>{t('Start over')}</Button>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex w-fit items-center gap-1 text-xs text-gray-11 transition-colors hover:text-gray-12"
    >
      <ArrowLeft className="size-3.5" />
      {t('Back')}
    </button>
  );
}

function StepHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <h2 className="text-lg font-semibold text-gray-12">{title}</h2>
      {description && <p className="text-sm text-gray-11">{description}</p>}
    </div>
  );
}

type StepProps = {
  challengeToken: string;
  onAuthenticated: (authentication: AuthenticationResponse) => void;
  onChallengeExpired: () => void;
};

type MfaChallengeProps = {
  challenge: MfaChallengeResponse;
  onAuthenticated: (authentication: AuthenticationResponse) => void;
  onBack: () => void;
};

export { MfaChallenge };
