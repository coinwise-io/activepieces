import { MfaEnrollmentSecret } from '@activepieces/shared';
import { t } from 'i18next';
import { QRCodeSVG } from 'qrcode.react';

import { CopyToClipboardInput } from '@/components/custom/clipboard/copy-to-clipboard';

function MfaEnrollmentSecretPanel({
  enrollment,
}: {
  enrollment: MfaEnrollmentSecret;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-11">
        {t(
          'Scan this QR code with your authenticator app, or enter the setup key manually.',
        )}
      </p>
      <div className="w-fit rounded-xl border border-gray-6 bg-white p-3">
        <QRCodeSVG
          value={enrollment.otpauthUri}
          size={176}
          title={t('Two-factor authentication QR code')}
          data-testid="mfa-qr-code"
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-gray-11">
          {t('Setup key')}
        </span>
        <CopyToClipboardInput textToCopy={enrollment.secret} useInput={true} />
      </div>
    </div>
  );
}

export { MfaEnrollmentSecretPanel };
