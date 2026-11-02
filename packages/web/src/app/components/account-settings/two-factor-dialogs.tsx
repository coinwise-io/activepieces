import { MfaEnrollmentSecret } from '@activepieces/shared';
import { t } from 'i18next';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MfaCodeForm } from '@/features/authentication/components/mfa/mfa-code-form';
import { MfaEnrollmentSecretPanel } from '@/features/authentication/components/mfa/mfa-enrollment-secret';
import { MfaRecoveryCodesPanel } from '@/features/authentication/components/mfa/mfa-recovery-codes';
import { mfaMutations } from '@/features/authentication/hooks/mfa-hooks';
import { authenticationSession } from '@/lib/authentication-session';

function EnableTwoFactorDialog({
  enrollment,
  onOpenChange,
}: EnableTwoFactorDialogProps) {
  return (
    <Dialog open={enrollment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-md overflow-y-auto">
        {enrollment !== null && (
          <EnableTwoFactorContent
            key={enrollment.secret}
            enrollment={enrollment}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnableTwoFactorContent({
  enrollment,
}: {
  enrollment: MfaEnrollmentSecret;
}) {
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const { mutateAsync: confirmSetup } = mfaMutations.useConfirmSetup();

  if (recoveryCodes !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('Save your recovery codes')}</DialogTitle>
          <DialogDescription>
            {t(
              'Use a recovery code to sign in if you lose access to your authenticator app. Your other sessions were signed out, so sign in again with your new second factor.',
            )}
          </DialogDescription>
        </DialogHeader>
        <MfaRecoveryCodesPanel recoveryCodes={recoveryCodes} />
        <DialogFooter>
          <Button
            onClick={() => authenticationSession.logOut()}
            data-testid="mfa-recovery-saved"
          >
            {t('I saved my recovery codes')}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Set up two-factor authentication')}</DialogTitle>
      </DialogHeader>
      <MfaEnrollmentSecretPanel enrollment={enrollment} />
      <p className="text-sm text-gray-11">
        {t('Then enter the 6-digit code shown in your app.')}
      </p>
      <MfaCodeForm
        submitLabel={t('Confirm')}
        allowRecoveryCode={false}
        submit={async (code) => {
          const response = await confirmSetup({ code });
          setRecoveryCodes(response.recoveryCodes);
        }}
      />
    </>
  );
}

function RegenerateRecoveryCodesDialog({
  open,
  onOpenChange,
}: TwoFactorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-md overflow-y-auto">
        <RegenerateRecoveryCodesContent
          key={open ? 'open' : 'closed'}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RegenerateRecoveryCodesContent({ onClose }: { onClose: () => void }) {
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const { mutateAsync: regenerate } = mfaMutations.useRegenerateRecoveryCodes();

  if (recoveryCodes !== null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t('Your new recovery codes')}</DialogTitle>
          <DialogDescription>
            {t('Your previous recovery codes no longer work.')}
          </DialogDescription>
        </DialogHeader>
        <MfaRecoveryCodesPanel recoveryCodes={recoveryCodes} />
        <DialogFooter>
          <Button onClick={onClose} data-testid="mfa-recovery-saved">
            {t('I saved my recovery codes')}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Generate new recovery codes')}</DialogTitle>
        <DialogDescription>
          {t(
            'Enter a code from your authenticator app. Your previous recovery codes will stop working.',
          )}
        </DialogDescription>
      </DialogHeader>
      <MfaCodeForm
        submitLabel={t('Generate codes')}
        allowRecoveryCode={false}
        submit={async (code) => {
          const response = await regenerate({ code });
          setRecoveryCodes(response.recoveryCodes);
        }}
      />
    </>
  );
}

function DisableTwoFactorDialog({
  open,
  onOpenChange,
  requiredByPlatform,
}: TwoFactorDialogProps & { requiredByPlatform: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DisableTwoFactorContent
          key={open ? 'open' : 'closed'}
          requiredByPlatform={requiredByPlatform}
        />
      </DialogContent>
    </Dialog>
  );
}

function DisableTwoFactorContent({
  requiredByPlatform,
}: {
  requiredByPlatform: boolean;
}) {
  const { mutateAsync: disable } = mfaMutations.useDisable();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('Disable two-factor authentication')}</DialogTitle>
        <DialogDescription>
          {requiredByPlatform
            ? t(
                'Your organization requires two-factor authentication, so you will be asked to set it up again the next time you sign in with your password. Enter a code from your authenticator app to continue.',
              )
            : t(
                'Enter a code from your authenticator app to turn off two-factor authentication.',
              )}
        </DialogDescription>
      </DialogHeader>
      <MfaCodeForm
        submitLabel={t('Disable')}
        allowRecoveryCode={true}
        submit={async (code) => {
          await disable({ code });
          toast.success(t('Two-factor authentication disabled'));
          authenticationSession.logOut();
        }}
      />
    </>
  );
}

type TwoFactorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type EnableTwoFactorDialogProps = {
  enrollment: MfaEnrollmentSecret | null;
  onOpenChange: (open: boolean) => void;
};

export {
  EnableTwoFactorDialog,
  RegenerateRecoveryCodesDialog,
  DisableTwoFactorDialog,
};
