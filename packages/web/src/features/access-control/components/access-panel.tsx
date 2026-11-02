import {
  AccessGrantPrincipal,
  AccessGrantWithPrincipal,
  AccessPrincipalType,
  AccessRole,
  AccessTarget,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { SearchableSelect } from '@/components/custom/searchable-select';
import { LoadingSpinner } from '@/components/custom/spinner';
import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { UserAvatar } from '@/components/custom/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INTERNAL_ERROR_MESSAGE } from '@/components/ui/sonner';
import {
  accessControlHooks,
  accessControlMutations,
} from '@/hooks/access-control-hooks';
import { api } from '@/lib/api';

import { accessRoleCopy } from '../lib/access-role-copy';

export function AccessPanel({ target }: AccessPanelProps) {
  const { data: effective } = accessControlHooks.useEffectiveAccess({
    request: {
      projectId: target.projectId,
      folderId: target.folderId,
      flowId: target.flowId,
    },
    enabled: true,
  });
  const canManageAccess = effective?.canManageAccess ?? false;
  const {
    data: grants,
    isLoading,
    isError,
    refetch,
  } = accessControlHooks.useGrants({ target, enabled: true });
  const exactScope = accessRoleCopy.scopeOfTarget(target);

  return (
    <div className="flex flex-col gap-4">
      {canManageAccess && <AddGrantForm target={target} />}
      <div className="flex flex-col gap-2">
        {isLoading && (
          <div className="flex justify-center py-6">
            <LoadingSpinner />
          </div>
        )}
        {isError && (
          <DataFetchErrorState entity={t('access')} onRetry={() => refetch()} />
        )}
        {!isLoading && !isError && grants?.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-11">
            {t('No one has been given access yet.')}
          </p>
        )}
        {grants?.map((grant) => (
          <GrantRow
            key={grant.id}
            grant={grant}
            inherited={grant.scope !== exactScope}
            removable={canManageAccess && grant.scope === exactScope}
          />
        ))}
      </div>
    </div>
  );
}

function principalKey(principal: AccessGrantPrincipal): string {
  return `${principal.type}:${principal.id}`;
}

function principalName(principal: AccessGrantPrincipal): string {
  if (principal.type === AccessPrincipalType.GROUP) {
    return principal.displayName;
  }
  const fullName = `${principal.firstName} ${principal.lastName}`.trim();
  return fullName.length > 0 ? fullName : principal.email;
}

function principalLabel(principal: AccessGrantPrincipal): string {
  if (principal.type === AccessPrincipalType.GROUP) {
    return principal.displayName;
  }
  return `${principalName(principal)} (${principal.email})`;
}

function PrincipalIdentity({ principal }: { principal: AccessGrantPrincipal }) {
  if (principal.type === AccessPrincipalType.GROUP) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-4 text-gray-11">
          <Users className="size-3.5" />
        </div>
        <TextWithTooltip tooltipMessage={principal.displayName}>
          <span className="text-sm font-medium">{principal.displayName}</span>
        </TextWithTooltip>
        <Badge variant="outline">{t('Group')}</Badge>
      </div>
    );
  }
  const name = principalName(principal);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <UserAvatar
        name={name}
        email={principal.email}
        size={24}
        disableTooltip={true}
      />
      <div className="flex min-w-0 flex-col">
        <TextWithTooltip tooltipMessage={name}>
          <span className="text-sm font-medium">{name}</span>
        </TextWithTooltip>
        <TextWithTooltip tooltipMessage={principal.email}>
          <span className="text-xs text-gray-11">{principal.email}</span>
        </TextWithTooltip>
      </div>
    </div>
  );
}

function GrantRow({ grant, inherited, removable }: GrantRowProps) {
  const { mutate: removeGrant, isPending } =
    accessControlMutations.useDeleteGrant({});
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
      data-testid="access-grant-row"
    >
      <div className="min-w-0 flex-1">
        <PrincipalIdentity principal={grant.principal} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary">
          {accessRoleCopy.roleLabel(grant.role)}
        </Badge>
        {inherited && (
          <span className="text-xs text-gray-11">
            {accessRoleCopy.inheritedLabel(grant.scope)}
          </span>
        )}
        {removable && (
          <Button
            variant="ghost"
            size="icon-sm"
            loading={isPending}
            aria-label={t('Remove access for {name}', {
              name: principalName(grant.principal),
            })}
            onClick={() => removeGrant(grant.id)}
          >
            <Trash2 className="size-4 text-danger-11" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddGrantForm({ target }: { target: AccessTarget }) {
  const [search, setSearch] = useState('');
  const [principal, setPrincipal] = useState<AccessGrantPrincipal | null>(null);
  const [role, setRole] = useState<AccessRole>(AccessRole.EXECUTOR);
  const { data: principals, isLoading } = accessControlHooks.usePrincipals({
    projectId: target.projectId,
    search,
    enabled: true,
  });
  const { mutate: createGrant, isPending } =
    accessControlMutations.useCreateGrant({
      onSuccess: () => {
        setPrincipal(null);
        setSearch('');
      },
    });

  const options = (principals ?? []).map((candidate) => ({
    value: principalKey(candidate),
    label: principalLabel(candidate),
    description:
      candidate.type === AccessPrincipalType.GROUP ? t('Group') : t('User'),
  }));
  const cachedOptions = principal
    ? [{ value: principalKey(principal), label: principalLabel(principal) }]
    : [];

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!principal) {
      return;
    }
    createGrant(
      {
        ...target,
        principalType: principal.type,
        principalId: principal.id,
        role,
      },
      {
        onError: (error) => {
          toast.error(
            api.extractServerErrorMessage(error, INTERNAL_ERROR_MESSAGE),
          );
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('User or group')}</span>
        <SearchableSelect
          options={options}
          cachedOptions={cachedOptions}
          value={principal ? principalKey(principal) : undefined}
          placeholder={t('Search users and groups')}
          loading={isLoading}
          refreshOnSearch={setSearch}
          onChange={(key) =>
            setPrincipal(
              (principals ?? []).find(
                (candidate) => principalKey(candidate) === key,
              ) ?? null,
            )
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('Role')}</span>
        <Select
          value={role}
          onValueChange={(value) =>
            setRole(
              accessRoleCopy.ACCESS_ROLES_IN_ORDER.find(
                (candidate) => candidate === value,
              ) ?? AccessRole.EXECUTOR,
            )
          }
        >
          <SelectTrigger aria-label={t('Role')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accessRoleCopy.ACCESS_ROLES_IN_ORDER.map((option) => (
              <SelectItem key={option} value={option}>
                <div className="flex flex-col items-start">
                  <span>{accessRoleCopy.roleLabel(option)}</span>
                  <span className="text-xs text-gray-11">
                    {accessRoleCopy.roleDescription(option)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-11">
          {accessRoleCopy.roleDescription(role)}
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={!principal}
          loading={isPending}
        >
          {t('Give access')}
        </Button>
      </div>
    </form>
  );
}

type AccessPanelProps = {
  target: AccessTarget;
};

type GrantRowProps = {
  grant: AccessGrantWithPrincipal;
  inherited: boolean;
  removable: boolean;
};
