import {
  AccessTarget,
  CreateAccessGrantRequest,
  GetEffectiveAccessRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';

import { accessControlApi } from '@/api/access-control-api';

const accessControlKeys = {
  all: ['access-grants'] as const,
  grants: (target: AccessTarget) =>
    [...accessControlKeys.all, 'list', target] as const,
  effective: (request: GetEffectiveAccessRequest) =>
    [...accessControlKeys.all, 'effective', request] as const,
  principals: ({ projectId, search }: { projectId: string; search: string }) =>
    [...accessControlKeys.all, 'principals', projectId, search] as const,
};

const PRINCIPAL_SEARCH_DEBOUNCE_MS = 250;
const PRINCIPAL_SEARCH_MIN_LENGTH = 3;

const accessControlHooks = {
  useGrants({ target, enabled }: { target: AccessTarget; enabled: boolean }) {
    return useQuery({
      queryKey: accessControlKeys.grants(target),
      queryFn: async () => (await accessControlApi.listGrants(target)).data,
      enabled,
    });
  },
  useEffectiveAccess({
    request,
    enabled,
  }: {
    request: GetEffectiveAccessRequest;
    enabled: boolean;
  }) {
    return useQuery({
      queryKey: accessControlKeys.effective(request),
      queryFn: () => accessControlApi.getEffectiveAccess(request),
      enabled,
      retry: false,
    });
  },
  usePrincipals({
    projectId,
    search,
    enabled,
  }: {
    projectId: string;
    search: string;
    enabled: boolean;
  }) {
    const [debouncedSearch] = useDebounce(
      search.trim(),
      PRINCIPAL_SEARCH_DEBOUNCE_MS,
    );
    return useQuery({
      queryKey: accessControlKeys.principals({
        projectId,
        search: debouncedSearch,
      }),
      queryFn: async () =>
        (
          await accessControlApi.listPrincipals({
            projectId,
            search: debouncedSearch,
          })
        ).data,
      enabled: enabled && debouncedSearch.length >= PRINCIPAL_SEARCH_MIN_LENGTH,
    });
  },
};

const accessControlMutations = {
  useCreateGrant({ onSuccess }: { onSuccess?: () => void }) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: CreateAccessGrantRequest) =>
        accessControlApi.createGrant(request),
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: accessControlKeys.all,
        });
        onSuccess?.();
      },
    });
  },
  useDeleteGrant({ onSuccess }: { onSuccess?: () => void }) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (grantId: string) => accessControlApi.deleteGrant(grantId),
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: accessControlKeys.all,
        });
        onSuccess?.();
      },
    });
  },
};

export {
  PRINCIPAL_SEARCH_MIN_LENGTH,
  accessControlHooks,
  accessControlKeys,
  accessControlMutations,
};
