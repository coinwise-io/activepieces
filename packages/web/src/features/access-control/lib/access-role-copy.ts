import { AccessGrantScope, AccessRole } from '@activepieces/shared';
import { t } from 'i18next';

function roleLabel(role: AccessRole): string {
  switch (role) {
    case AccessRole.EDITOR:
      return t('Editor');
    case AccessRole.EXECUTOR:
      return t('Executor');
    case AccessRole.HISTORY_READER:
      return t('History reader');
  }
}

function roleDescription(role: AccessRole): string {
  switch (role) {
    case AccessRole.EDITOR:
      return t('Can change the flow and see all runs');
    case AccessRole.EXECUTOR:
      return t('Can run the flow and see their own runs');
    case AccessRole.HISTORY_READER:
      return t('Can see all runs, read-only');
  }
}

function inheritedLabel(scope: AccessGrantScope): string {
  switch (scope) {
    case AccessGrantScope.PROJECT:
      return t('Inherited from project');
    case AccessGrantScope.FOLDER:
      return t('Inherited from folder');
    case AccessGrantScope.FLOW:
      return t('Direct');
  }
}

function scopeOfTarget({
  folderId,
  flowId,
}: {
  folderId?: string;
  flowId?: string;
}): AccessGrantScope {
  if (flowId) {
    return AccessGrantScope.FLOW;
  }
  if (folderId) {
    return AccessGrantScope.FOLDER;
  }
  return AccessGrantScope.PROJECT;
}

const ACCESS_ROLES_IN_ORDER: AccessRole[] = [
  AccessRole.EDITOR,
  AccessRole.EXECUTOR,
  AccessRole.HISTORY_READER,
];

export const accessRoleCopy = {
  roleLabel,
  roleDescription,
  inheritedLabel,
  scopeOfTarget,
  ACCESS_ROLES_IN_ORDER,
};
