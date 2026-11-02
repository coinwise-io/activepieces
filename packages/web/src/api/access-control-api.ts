import {
  AccessGrantWithPrincipal,
  AccessTarget,
  CreateAccessGrantRequest,
  EffectiveAccess,
  GetEffectiveAccessRequest,
  ListAccessGrantsResponse,
  ListAccessPrincipalsRequest,
  ListAccessPrincipalsResponse,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const accessControlApi = {
  listGrants(request: AccessTarget) {
    return api.get<ListAccessGrantsResponse>('/v1/access-grants', request);
  },
  createGrant(request: CreateAccessGrantRequest) {
    return api.post<AccessGrantWithPrincipal>('/v1/access-grants', request);
  },
  deleteGrant(grantId: string) {
    return api.delete<void>(`/v1/access-grants/${grantId}`);
  },
  getEffectiveAccess(request: GetEffectiveAccessRequest) {
    return api.get<EffectiveAccess>('/v1/access-grants/effective', request);
  },
  listPrincipals(request: ListAccessPrincipalsRequest) {
    return api.get<ListAccessPrincipalsResponse>(
      '/v1/access-grants/principals',
      request,
    );
  },
};
