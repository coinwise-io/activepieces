import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { platformHooks } from '@/hooks/platform-hooks';

import { scimApi } from '../api/scim-api';

export const scimKeys = {
  tokens: ['scim-tokens'] as const,
  userGroups: ['user-groups'] as const,
};

export const scimQueries = {
  useTokens: () => {
    const { platform } = platformHooks.useCurrentPlatform();
    return useQuery({
      queryKey: scimKeys.tokens,
      queryFn: () => scimApi.listTokens(),
      enabled: platform.plan.scimEnabled,
    });
  },
  useUserGroups: () => {
    const { platform } = platformHooks.useCurrentPlatform();
    return useQuery({
      queryKey: scimKeys.userGroups,
      queryFn: () => scimApi.listUserGroups(),
      enabled: platform.plan.scimEnabled,
    });
  },
};

export const scimMutations = {
  useCreateToken: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: { displayName: string }) =>
        scimApi.createToken(request),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: scimKeys.tokens });
      },
    });
  },
  useDeleteToken: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (tokenId: string) => scimApi.deleteToken(tokenId),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: scimKeys.tokens });
      },
    });
  },
};
