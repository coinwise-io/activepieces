import { t } from 'i18next';

import { CopyToClipboardInput } from '@/components/custom/clipboard/copy-to-clipboard';

function MfaRecoveryCodesPanel({ recoveryCodes }: { recoveryCodes: string[] }) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-11">
        {t(
          'Each recovery code works once. Store them somewhere safe, they will not be shown again.',
        )}
      </p>
      <CopyToClipboardInput
        textToCopy={recoveryCodes.join('\n')}
        useInput={false}
        fileName="recovery-codes.txt"
      />
    </div>
  );
}

export { MfaRecoveryCodesPanel };
