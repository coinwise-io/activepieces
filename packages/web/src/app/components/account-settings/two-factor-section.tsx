import { MfaEnrollmentSecret } from '@activepieces/shared';
import { t } from 'i18next';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  mfaHooks,
  mfaMutations,
} from '@/features/authentication/hooks/mfa-hooks';

import { SettingRow } from './setting-row';
import {
  DisableTwoFactorDialog,
  EnableTwoFactorDialog,
  RegenerateRecoveryCodesDialog,
} from './two-factor-dialogs';

function TwoFactorSection() {
  const { data: status } = mfaHooks.useStatus();
  const [enrollment, setEnrollment] = useState<MfaEnrollmentSecret | null>(
    null,
  );
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  const { mutate: startSetup, isPending: isStarting } =
    mfaMutations.useStartSetup();

  if (status === undefined) {
    return null;
  }

  const handleEnable = () => {
    startSetup(undefined, {
      onSuccess: setEnrollment,
      onError: () =>
        toast.error(t('Something went wrong, please try again later')),
    });
  };

  return (
    <>
      <SettingRow
        title={t('Two-factor authentication')}
        description={
          status.enabled
            ? t(
                '{count, plural, =1 {Enabled, 1 recovery code left} other {Enabled, # recovery codes left}}',
                { count: status.recoveryCodesRemaining },
              )
            : status.requiredByPlatform
            ? t('Required by your organization')
            : t('Add a second step when you sign in with a password')
        }
      >
        {status.enabled ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRegenerateOpen(true)}
              data-testid="mfa-regenerate-open"
            >
              {t('Recovery codes')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisableOpen(true)}
              data-testid="mfa-disable-open"
            >
              {t('Disable')}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            loading={isStarting}
            onClick={handleEnable}
            data-testid="mfa-enable"
          >
            {t('Enable')}
          </Button>
        )}
      </SettingRow>
      <EnableTwoFactorDialog
        enrollment={enrollment}
        onOpenChange={(open) => {
          if (!open) {
            setEnrollment(null);
          }
        }}
      />
      <RegenerateRecoveryCodesDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
      />
      <DisableTwoFactorDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        requiredByPlatform={status.requiredByPlatform}
      />
    </>
  );
}

export { TwoFactorSection };
