import { ApFlagId, ScimToken } from '@activepieces/shared';
import { t } from 'i18next';
import { KeyRound, MoreHorizontal, Trash } from 'lucide-react';

import {
  AdminEmpty,
  AdminSection,
  SettingsPanel,
  SettingsRow,
} from '@/app/components/admin';
import { NewScimTokenDialog } from '@/app/routes/platform/security/sso/new-scim-token-dialog';
import { CopyToClipboardInput } from '@/components/custom/clipboard/copy-to-clipboard';
import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { ConfirmationDeleteDialog } from '@/components/custom/delete-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { SkeletonList } from '@/components/ui/skeleton';
import { internalErrorToast } from '@/components/ui/sonner';
import { scimMutations, scimQueries } from '@/features/platform-admin';
import { flagsHooks } from '@/hooks/flags-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { formatUtils } from '@/lib/format-utils';

export const ScimSection = () => {
  const { platform } = platformHooks.useCurrentPlatform();
  const { data: publicUrl } = flagsHooks.useFlag<string>(ApFlagId.PUBLIC_URL);
  const { data, isLoading, isError, refetch } = scimQueries.useTokens();
  const { mutateAsync: deleteToken } = scimMutations.useDeleteToken();

  if (!platform.plan.scimEnabled) {
    return null;
  }

  const tokens = data?.data ?? [];
  const showLoading = isLoading;
  const showEmpty = !isLoading && !isError && tokens.length === 0;
  const showList = !isLoading && !isError && tokens.length > 0;

  return (
    <AdminSection
      title={t('SCIM provisioning')}
      description={t(
        'Let your identity provider create, update and deactivate users and groups automatically.',
      )}
      action={
        <NewScimTokenDialog>
          <Button size="sm">{t('Generate token')}</Button>
        </NewScimTokenDialog>
      }
    >
      {publicUrl && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label>{t('SCIM base URL')}</Label>
          <CopyToClipboardInput
            textToCopy={buildScimBaseUrl(publicUrl)}
            useInput={true}
          />
        </div>
      )}
      {showLoading && <SkeletonList numberOfItems={2} className="h-18" />}
      {isError && (
        <DataFetchErrorState
          entity={t('SCIM tokens')}
          onRetry={() => refetch()}
        />
      )}
      {showEmpty && (
        <AdminEmpty
          icon={<KeyRound />}
          title={t('No SCIM tokens yet')}
          description={t(
            'Generate a token and paste it into your identity provider to start provisioning.',
          )}
        />
      )}
      {showList && (
        <SettingsPanel flush>
          {tokens.map((token) => (
            <ScimTokenRow
              key={token.id}
              token={token}
              onRevoke={async () => {
                await deleteToken(token.id);
              }}
            />
          ))}
        </SettingsPanel>
      )}
    </AdminSection>
  );
};

const ScimTokenRow = ({ token, onRevoke }: ScimTokenRowProps) => (
  <SettingsRow
    icon={<KeyRound />}
    title={token.displayName}
    description={
      <span className="text-xs">
        {t('Created')} {formatUtils.formatDateToAgo(new Date(token.created))}
        {' · '}
        {token.lastUsedAt
          ? `${t('Last used')} ${formatUtils.formatDateToAgo(
              new Date(token.lastUsedAt),
            )}`
          : t('Never used')}
      </span>
    }
  >
    <DropdownMenu modal={true}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('Actions')}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ConfirmationDeleteDialog
          title={t('Revoke SCIM token')}
          message={t(
            'Revoking this token will immediately stop your identity provider from provisioning with it. This action cannot be undone.',
          )}
          entityName={token.displayName}
          buttonText={t('Revoke')}
          mutationFn={onRevoke}
          onError={() => internalErrorToast()}
        >
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => e.preventDefault()}
          >
            <Trash className="size-4" />
            {t('Revoke SCIM token')}
          </DropdownMenuItem>
        </ConfirmationDeleteDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  </SettingsRow>
);

function buildScimBaseUrl(publicUrl: string) {
  return `${publicUrl.replace(/\/+$/, '')}/api/v1/scim/v2`;
}

type ScimTokenRowProps = {
  token: ScimToken;
  onRevoke: () => Promise<void>;
};
