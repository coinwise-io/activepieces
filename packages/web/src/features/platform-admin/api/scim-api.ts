import {
  CreateScimTokenRequest,
  CreateScimTokenResponse,
  ListScimTokensResponse,
  ListUserGroupsResponse,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const scimApi = {
  listTokens() {
    return api.get<ListScimTokensResponse>('/v1/scim-tokens');
  },
  createToken(request: CreateScimTokenRequest) {
    return api.post<CreateScimTokenResponse>('/v1/scim-tokens', request);
  },
  deleteToken(tokenId: string) {
    return api.delete<void>(`/v1/scim-tokens/${tokenId}`);
  },
  listUserGroups() {
    return api.get<ListUserGroupsResponse>('/v1/user-groups');
  },
};
