import { isNil, Permission } from '@activepieces/core-utils';
import { PlatformRole } from '@activepieces/shared';
import { createContext, useContext } from 'react';

import { accessControlHooks } from '@/hooks/access-control-hooks';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';

const FlowAccessContext = createContext<string | undefined>(undefined);

const FlowAccessProvider = FlowAccessContext.Provider;

function isReadPermission(permission: Permission): boolean {
  return permission.startsWith('READ_');
}

function resolvePermission({
  permission,
  permissions,
  isLoading,
}: {
  permission: Permission;
  permissions: Permission[] | undefined;
  isLoading: boolean;
}): boolean {
  if (!isNil(permissions)) {
    return permissions.includes(permission);
  }
  return isLoading && isReadPermission(permission);
}

const useEffectivePermissions = ({
  projectId,
  flowId,
}: {
  projectId?: string;
  flowId?: string;
}) => {
  const scopedProjectId = projectId ?? authenticationSession.getProjectId();
  const platformId = authenticationSession.getPlatformId();
  const enabled = !isNil(scopedProjectId) && !isNil(platformId);
  const { data, isLoading, isError } = accessControlHooks.useEffectiveAccess({
    request: { projectId: scopedProjectId ?? '', flowId },
    enabled,
  });
  const permissions = data?.permissions;
  const checkAccess = (permission: Permission) =>
    resolvePermission({
      permission,
      permissions,
      isLoading: isLoading || !enabled,
    });
  return {
    checkAccess,
    canManageAccess: data?.canManageAccess ?? false,
    isLoading: enabled && isLoading,
    isError,
  };
};

export const useAuthorization = (projectId?: string) => {
  const contextFlowId = useContext(FlowAccessContext);
  const { checkAccess, isLoading } = useEffectivePermissions({
    projectId,
    flowId: contextFlowId,
  });
  return { checkAccess, isFetchingProjectRole: isLoading };
};

export const useFlowAccess = (flowId: string) => {
  const { checkAccess, canManageAccess, isLoading, isError } =
    useEffectivePermissions({ flowId });
  return { checkAccess, canManageAccess, isLoading, isError };
};

export const useIsPlatformAdmin = () => {
  const platformRole = userHooks.getCurrentUserPlatformRole();
  return platformRole === PlatformRole.ADMIN;
};

export const useIsPlatformPrivileged = () => {
  const platformRole = userHooks.getCurrentUserPlatformRole();
  return (
    platformRole === PlatformRole.ADMIN ||
    platformRole === PlatformRole.OPERATOR
  );
};

export { FlowAccessProvider };
