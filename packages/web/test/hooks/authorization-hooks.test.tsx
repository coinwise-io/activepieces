/**
 * @vitest-environment jsdom
 */
import { Permission } from '@activepieces/core-utils';
import { AccessRole } from '@activepieces/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getEffectiveAccess: vi.fn(),
}));

vi.mock('@/api/access-control-api', () => ({ accessControlApi: api }));

vi.mock('@/hooks/user-hooks', () => ({
  userHooks: { getCurrentUserPlatformRole: () => undefined },
}));

vi.mock('@/lib/authentication-session', () => ({
  authenticationSession: {
    getProjectId: () => 'project',
    getPlatformId: () => 'platform',
  },
}));

import { useAuthorization, useFlowAccess } from '@/hooks/authorization-hooks';

function wrapper({ children }: React.PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useAuthorization', () => {
  beforeEach(() => {
    api.getEffectiveAccess.mockReset();
  });

  it('while loading grants read permissions and denies write, update and execute', () => {
    api.getEffectiveAccess.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useAuthorization(), { wrapper });

    expect(result.current.isFetchingProjectRole).toBe(true);
    expect(result.current.checkAccess(Permission.READ_FLOW)).toBe(true);
    expect(result.current.checkAccess(Permission.WRITE_FLOW)).toBe(false);
    expect(result.current.checkAccess(Permission.UPDATE_FLOW_STATUS)).toBe(
      false,
    );
    expect(result.current.checkAccess(Permission.EXECUTE_FLOW)).toBe(false);
  });

  it('answers from the effective permissions once loaded', async () => {
    api.getEffectiveAccess.mockResolvedValue({
      roles: [AccessRole.EXECUTOR],
      permissions: [Permission.READ_FLOW, Permission.EXECUTE_FLOW],
      canManageAccess: false,
    });
    const { result } = renderHook(() => useAuthorization(), { wrapper });

    await waitFor(() =>
      expect(result.current.isFetchingProjectRole).toBe(false),
    );
    expect(result.current.checkAccess(Permission.EXECUTE_FLOW)).toBe(true);
    expect(result.current.checkAccess(Permission.READ_FLOW)).toBe(true);
    expect(result.current.checkAccess(Permission.WRITE_FLOW)).toBe(false);
    expect(result.current.checkAccess(Permission.READ_RUN)).toBe(false);
    expect(api.getEffectiveAccess).toHaveBeenCalledWith({
      projectId: 'project',
      flowId: undefined,
    });
  });

  it('never grants anything when the request fails', async () => {
    api.getEffectiveAccess.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useAuthorization(), { wrapper });

    await waitFor(() =>
      expect(result.current.isFetchingProjectRole).toBe(false),
    );
    expect(result.current.checkAccess(Permission.WRITE_FLOW)).toBe(false);
    expect(result.current.checkAccess(Permission.EXECUTE_FLOW)).toBe(false);
    expect(result.current.checkAccess(Permission.READ_FLOW)).toBe(false);
  });
});

describe('useFlowAccess', () => {
  it('asks for the permissions on that flow', async () => {
    api.getEffectiveAccess.mockResolvedValue({
      roles: [AccessRole.EDITOR],
      permissions: [Permission.WRITE_FLOW],
      canManageAccess: true,
    });
    const { result } = renderHook(() => useFlowAccess('flow-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.checkAccess(Permission.WRITE_FLOW)).toBe(true);
    expect(result.current.canManageAccess).toBe(true);
    expect(api.getEffectiveAccess).toHaveBeenCalledWith({
      projectId: 'project',
      flowId: 'flow-1',
    });
  });
});
