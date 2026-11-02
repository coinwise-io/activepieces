/**
 * @vitest-environment jsdom
 */
/* eslint-disable jest-dom/prefer-in-document -- @testing-library/jest-dom is not a dependency of packages/web */
import { Permission } from '@activepieces/core-utils';
import {
  AccessRole,
  FlowOperationStatus,
  FlowStatus,
  FlowTriggerType,
  FlowVersionState,
  PopulatedFlow,
} from '@activepieces/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getEffectiveAccess: vi.fn(),
}));

const builder = vi.hoisted(() => ({
  createBuilderStore: vi.fn((initialState: { readonly: boolean }) => ({
    readonly: initialState.readonly,
  })),
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

vi.mock('@/app/builder/builder-hooks', () => ({
  BuilderStateContext: React.createContext(null),
  createBuilderStore: builder.createBuilderStore,
}));

vi.mock('@/components/providers/socket-provider', () => ({
  useSocket: () => ({}),
}));

vi.mock('@/features/projects', () => ({
  projectHooks: { useReloadPageIfProjectIdChanged: () => undefined },
}));

vi.mock('@/components/custom/loading-screen', () => ({
  LoadingScreen: () => <div>loading</div>,
}));

import { BuilderStateProvider } from '@/app/builder/state/builder-state-provider';

const flow: PopulatedFlow = {
  id: 'flow-1',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  projectId: 'project',
  externalId: 'flow-1',
  ownerId: null,
  folderId: null,
  status: FlowStatus.DISABLED,
  publishedVersionId: null,
  metadata: null,
  operationStatus: FlowOperationStatus.NONE,
  timeSavedPerRun: null,
  templateId: null,
  createdBy: null,
  version: {
    id: 'draft-1',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    flowId: 'flow-1',
    displayName: 'Order lookup',
    trigger: {
      name: 'trigger',
      valid: true,
      displayName: 'Select Trigger',
      type: FlowTriggerType.EMPTY,
      settings: {},
      lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    },
    updatedBy: null,
    valid: true,
    schemaVersion: null,
    agentIds: [],
    state: FlowVersionState.DRAFT,
    connectionIds: [],
    backupFiles: null,
    notes: [],
  },
};

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BuilderStateProvider
        flow={flow}
        flowVersion={flow.version}
        readonly={false}
        hideTestWidget={false}
        run={null}
        outputSampleData={{}}
        inputSampleData={{}}
      >
        <div>builder</div>
      </BuilderStateProvider>
    </QueryClientProvider>,
  );
}

describe('BuilderStateProvider access', () => {
  beforeEach(() => {
    builder.createBuilderStore.mockClear();
    api.getEffectiveAccess.mockReset();
  });

  it('waits for the flow permissions before creating the builder store', async () => {
    api.getEffectiveAccess.mockReturnValue(new Promise(() => undefined));
    renderProvider();

    expect(screen.getByText('loading')).toBeTruthy();
    expect(builder.createBuilderStore).not.toHaveBeenCalled();
  });

  it('opens the builder read-only when the user cannot write the flow', async () => {
    api.getEffectiveAccess.mockResolvedValue({
      roles: [AccessRole.HISTORY_READER],
      permissions: [Permission.READ_FLOW, Permission.READ_RUN],
      canManageAccess: false,
    });
    renderProvider();

    await screen.findByText('builder');
    expect(builder.createBuilderStore).toHaveBeenCalledWith(
      expect.objectContaining({ readonly: true }),
    );
    expect(api.getEffectiveAccess).toHaveBeenCalledWith({
      projectId: 'project',
      flowId: 'flow-1',
    });
  });

  it('opens the builder read-only when the permissions request fails', async () => {
    api.getEffectiveAccess.mockRejectedValue(new Error('forbidden'));
    renderProvider();

    await screen.findByText('builder');
    expect(builder.createBuilderStore).toHaveBeenCalledWith(
      expect.objectContaining({ readonly: true }),
    );
  });

  it('opens the builder editable when the user can write the flow', async () => {
    api.getEffectiveAccess.mockResolvedValue({
      roles: [AccessRole.EDITOR],
      permissions: [Permission.READ_FLOW, Permission.WRITE_FLOW],
      canManageAccess: true,
    });
    renderProvider();

    await waitFor(() =>
      expect(builder.createBuilderStore).toHaveBeenCalledWith(
        expect.objectContaining({ readonly: false }),
      ),
    );
  });
});
