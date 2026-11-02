import { isNil, tryCatch } from '@activepieces/core-utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from 'i18next';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Form, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import {
  MFA_TOTP_LENGTH,
  MfaCodeMode,
  mfaChallengeUtils,
} from '@/features/authentication/utils/mfa-challenge-utils';

function MfaCodeForm({
  submitLabel,
  allowRecoveryCode,
  submit,
  onChallengeExpired,
  secondaryAction,
}: MfaCodeFormProps) {
  const [mode, setMode] = useState<MfaCodeMode>('totp');
  const form = useForm<MfaCodeFormSchema>({
    resolver: zodResolver(createMfaCodeFormSchema()),
    defaultValues: { code: '' },
    mode: 'onChange',
  });

  const handleSubmit: SubmitHandler<MfaCodeFormSchema> = async ({ code }) => {
    form.clearErrors('root.serverError');
    const { error } = await tryCatch(() => submit(code.trim()));
    if (isNil(error)) {
      return;
    }
    const kind = mfaChallengeUtils.classifyError(error);
    if (kind === 'challenge-expired' && !isNil(onChallengeExpired)) {
      onChallengeExpired();
      return;
    }
    form.setValue('code', '');
    form.setError('root.serverError', {
      type: 'manual',
      message: serverErrorMessage(kind),
    });
  };

  const switchMode = () => {
    form.setValue('code', '');
    form.clearErrors();
    setMode(mode === 'totp' ? 'recovery' : 'totp');
  };

  const code = form.watch('code');
  const canSubmit = mfaChallengeUtils.isAcceptableCode({ code, mode });

  return (
    <Form {...form}>
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit(handleSubmit)}
        data-testid="mfa-code-form"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem className="grid gap-2">
              {mode === 'totp' ? (
                <InputOTP
                  maxLength={MFA_TOTP_LENGTH}
                  pattern={REGEXP_ONLY_DIGITS}
                  value={field.value}
                  onChange={(value) => {
                    form.clearErrors('root.serverError');
                    field.onChange(value);
                  }}
                  disabled={form.formState.isSubmitting}
                  autoFocus
                  data-testid="mfa-code"
                >
                  <InputOTPGroup>
                    {Array.from({ length: MFA_TOTP_LENGTH }).map((_, index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              ) : (
                <Input
                  {...field}
                  autoFocus
                  autoComplete="off"
                  placeholder="abcde-fghij"
                  disabled={form.formState.isSubmitting}
                  aria-label={t('Recovery code')}
                  data-testid="mfa-recovery-code"
                />
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root?.serverError && (
          <FormMessage>
            {form.formState.errors.root.serverError.message}
          </FormMessage>
        )}
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={form.formState.isSubmitting}
          data-testid="mfa-submit"
        >
          {submitLabel}
        </Button>
        {allowRecoveryCode && (
          <button
            type="button"
            onClick={switchMode}
            className="text-left text-xs text-gray-11 transition-colors hover:text-gray-12"
          >
            {mode === 'totp'
              ? t('Use a recovery code')
              : t('Use an authenticator code')}
          </button>
        )}
        {secondaryAction}
      </form>
    </Form>
  );
}

function createMfaCodeFormSchema() {
  return z.object({
    code: z.string().trim().min(6, t('Enter your verification code')),
  });
}

function serverErrorMessage(
  kind: ReturnType<typeof mfaChallengeUtils.classifyError>,
) {
  switch (kind) {
    case 'invalid-code':
      return t('Invalid code');
    case 'challenge-expired':
      return t('Your sign-in expired. Please start again.');
    default:
      return t('Something went wrong, please try again later');
  }
}

type MfaCodeFormSchema = z.infer<ReturnType<typeof createMfaCodeFormSchema>>;

type MfaCodeFormProps = {
  submitLabel: string;
  allowRecoveryCode: boolean;
  submit: (code: string) => Promise<unknown>;
  onChallengeExpired?: () => void;
  secondaryAction?: React.ReactNode;
};

export { MfaCodeForm };
