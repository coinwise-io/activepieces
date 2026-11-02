import { UserGroupWithMembers } from '@activepieces/shared';
import { t } from 'i18next';
import { ChevronDown, ChevronRight, UsersRound } from 'lucide-react';
import { useState } from 'react';

import {
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  SettingsPanel,
  SettingsRow,
  adminPageResources,
} from '@/app/components/admin';
import { DataFetchErrorState } from '@/components/custom/data-fetch-error-state';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { SkeletonList } from '@/components/ui/skeleton';
import { scimQueries } from '@/features/platform-admin';

const GroupsPage = () => {
  const { data, isLoading, isError, refetch } = scimQueries.useUserGroups();
  const groups = data?.data ?? [];

  return (
    <AdminPage width="content">
      <AdminPageHeader
        title={t('Groups')}
        description={t(
          'Groups are managed by your identity provider and are read-only here.',
        )}
        resources={adminPageResources.sso}
      />
      {isLoading && <SkeletonList numberOfItems={3} className="h-18" />}
      {isError && (
        <DataFetchErrorState entity={t('groups')} onRetry={() => refetch()} />
      )}
      {!isLoading && !isError && groups.length === 0 && (
        <AdminEmpty
          icon={<UsersRound />}
          title={t('No groups yet')}
          description={t(
            'Groups are provisioned from your identity provider through SCIM. Once your provider syncs them, they appear here.',
          )}
        />
      )}
      {!isLoading && !isError && groups.length > 0 && (
        <SettingsPanel flush>
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </SettingsPanel>
      )}
    </AdminPage>
  );
};

const GroupRow = ({ group }: GroupRowProps) => {
  const [open, setOpen] = useState(false);
  const memberCount = group.members.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SettingsRow
        icon={<UsersRound />}
        title={group.displayName}
        description={
          <span className="text-xs">
            {group.externalId
              ? t('External ID: {externalId}', {
                  externalId: group.externalId,
                })
              : t('No external ID')}
          </span>
        }
        below={
          <CollapsibleContent>
            {memberCount === 0 ? (
              <p className="text-sm text-gray-11">
                {t('This group has no members.')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
                  >
                    <span className="text-gray-12">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="text-gray-11">{member.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleContent>
        }
      >
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {t('{count, plural, =1 {1 member} other {# members}}', {
              count: memberCount,
            })}
          </Button>
        </CollapsibleTrigger>
      </SettingsRow>
    </Collapsible>
  );
};

type GroupRowProps = {
  group: UserGroupWithMembers;
};

GroupsPage.displayName = 'GroupsPage';
export { GroupsPage };
