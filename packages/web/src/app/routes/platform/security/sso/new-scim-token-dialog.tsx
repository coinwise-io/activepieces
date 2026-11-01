import { CreateScimTokenResponse, formErrors } from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from 'i18next';
import { TriangleAlert } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { adminLayout } from '@/app/components/admin';
import { CopyToClipboardInput } from '@/components/custom/clipboard/copy-to-clipboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { scimMutations } from '@/features/platform-admin';
import { api } from '@/lib/api';

export const NewScimTokenDialog = ({ children }: NewScimTokenDialogProps) => {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreateScimTokenResponse | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setCreated(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className={adminLayout.dialog.md}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {created ? t('SCIM token generated') : t('Generate SCIM token')}
          </DialogTitle>
          {!created && (
            <DialogDescription>
              {t(
                'Name the token after the identity provider that will use it.',
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        {created ? (
          <>
            <Alert variant="warning">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                {t(
                  "Copy this token now. For security reasons, it can't be shown again after you close this dialog.",
                )}
              </AlertDescription>
            </Alert>
            <CopyToClipboardInput textToCopy={created.token} useInput={true} />
            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => handleOpenChange(false)}
              >
                {t('Done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <NewScimTokenForm
            key={open ? 'open' : 'closed'}
            onCreated={setCreated}
            onCancel={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

const NewScimTokenForm = ({ onCreated, onCancel }: NewScimTokenFormProps) => {
  const form = useForm<FormSchema>({
    defaultValues: { displayName: '' },
    resolver: zodResolver(FormSchema),
    mode: 'onChange',
  });
  const { mutate, isPending } = scimMutations.useCreateToken();

  const handleSubmit = (values: FormSchema) => {
    form.clearErrors('root.serverError');
    mutate(values, {
      onSuccess: onCreated,
      onError: (error) => {
        form.setError('root.serverError', {
          type: 'manual',
          message: api.extractServerErrorMessage(
            error,
            t("Couldn't generate token"),
          ),
        });
      },
    });
  };

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem className="grid space-y-2">
              <FormLabel>{t('Name')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t('Token name')} autoFocus />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root?.serverError && (
          <FormMessage>
            {form.formState.errors.root.serverError.message}
          </FormMessage>
        )}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button type="submit" disabled={isPending} loading={isPending}>
            {t('Generate')}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
};

const FormSchema = z.object({
  displayName: z.string().min(1, formErrors.required).max(100),
});

type FormSchema = z.infer<typeof FormSchema>;

type NewScimTokenDialogProps = {
  children: ReactNode;
};

type NewScimTokenFormProps = {
  onCreated: (response: CreateScimTokenResponse) => void;
  onCancel: () => void;
};
