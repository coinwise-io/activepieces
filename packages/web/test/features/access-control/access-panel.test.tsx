/**
 * @vitest-environment jsdom
 */
/* eslint-disable jest-dom/prefer-in-document -- @testing-library/jest-dom is not a dependency of packages/web */
import {
  AccessGrantScope,
  AccessGrantWithPrincipal,
  AccessPrincipalType,
  AccessRole,
  AccessTarget,
  EffectiveAccess,
} from '@activepieces/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  t: (key: string, options?: Record<string, string>) =>
    key.replace('{name}', options?.name ?? ''),
}));

vi.mock('@/components/custom/user-avatar', () => ({
  UserAvatar: () => <span data-testid="avatar" />,
}));

vi.mock('@/components/custom/text-with-tooltip', () => ({
  TextWithTooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/components/custom/searchable-select', () => ({
  SearchableSelect: ({
    options,
    onChange,
    refreshOnSearch,
  }: {
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    refreshOnSearch: (search: string) => void;
  }) => (
    <div>
      <input
        aria-label="search principals"
        onChange={(event) => refreshOnSearch(event.target.value)}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {`pick ${option.label}`}
        </button>
      ))}
    </div>
  ),
}));

const api = vi.hoisted(() => ({
  listGrants: vi.fn(),
  createGrant: vi.fn(),
  deleteGrant: vi.fn(),
  getEffectiveAccess: vi.fn(),
  listPrincipals: vi.fn(),
}));

vi.mock('@/api/access-control-api', () => ({ accessControlApi: api }));

import { AccessPanel } from '@/features/access-control';

const ana: AccessGrantWithPrincipal = {
  id: 'grant-ana',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  platformId: 'platform',
  projectId: 'project',
  folderId: null,
  flowId: 'flow',
  userId: 'user-ana',
  groupId: null,
  role: AccessRole.EDITOR,
  createdBy: null,
  scope: AccessGrantScope.FLOW,
  principal: {
    type: AccessPrincipalType.USER,
    id: 'user-ana',
    email: 'ana@example.com',
    firstName: 'Ana',
    lastName: 'Silva',
  },
};

const supportGroup: AccessGrantWithPrincipal = {
  ...ana,
  id: 'grant-support',
  flowId: null,
  userId: null,
  groupId: 'group-support',
  role: AccessRole.EXECUTOR,
  scope: AccessGrantScope.PROJECT,
  principal: {
    type: AccessPrincipalType.GROUP,
    id: 'group-support',
    displayName: 'Support team',
  },
};

const managerAccess: EffectiveAccess = {
  roles: [AccessRole.EDITOR],
  permissions: [],
  canManageAccess: true,
};

function renderPanel(
  target: AccessTarget = { projectId: 'project', flowId: 'flow' },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessPanel target={target} />
    </QueryClientProvider>,
  );
}

describe('AccessPanel', () => {
  beforeEach(() => {
    api.getEffectiveAccess.mockResolvedValue(managerAccess);
    api.listGrants.mockResolvedValue({ data: [ana, supportGroup] });
    api.listPrincipals.mockResolvedValue({
      data: [
        {
          type: AccessPrincipalType.GROUP,
          id: 'group-onboarding',
          displayName: 'Onboarding',
        },
      ],
    });
    api.createGrant.mockResolvedValue(ana);
    api.deleteGrant.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists grants with role and inherited label', async () => {
    renderPanel();

    const rows = await screen.findAllByTestId('access-grant-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Ana Silva')).toBeTruthy();
    expect(within(rows[0]).getByText('Editor')).toBeTruthy();
    expect(within(rows[1]).getByText('Support team')).toBeTruthy();
    expect(within(rows[1]).getByText('Executor')).toBeTruthy();
    expect(within(rows[1]).getByText('Inherited from project')).toBeTruthy();
  });

  it('only lets exact-scope grants be removed', async () => {
    renderPanel();

    await screen.findAllByTestId('access-grant-row');
    expect(screen.getByLabelText('Remove access for Ana Silva')).toBeTruthy();
    expect(
      screen.queryByLabelText('Remove access for Support team'),
    ).toBeNull();
  });

  it('removes a grant', async () => {
    renderPanel();

    fireEvent.click(
      await screen.findByLabelText('Remove access for Ana Silva'),
    );

    await waitFor(() =>
      expect(api.deleteGrant).toHaveBeenCalledWith('grant-ana'),
    );
  });

  it('adds a grant for a picked principal with the chosen role', async () => {
    renderPanel();

    fireEvent.change(await screen.findByLabelText('search principals'), {
      target: { value: 'onb' },
    });
    fireEvent.click(await screen.findByText('pick Onboarding'));
    fireEvent.click(screen.getByRole('button', { name: 'Give access' }));

    await waitFor(() =>
      expect(api.createGrant).toHaveBeenCalledWith({
        projectId: 'project',
        flowId: 'flow',
        principalType: AccessPrincipalType.GROUP,
        principalId: 'group-onboarding',
        role: AccessRole.EXECUTOR,
      }),
    );
  });

  it('does not query grants or show the form when the user cannot manage access', async () => {
    api.getEffectiveAccess.mockResolvedValue({
      ...managerAccess,
      canManageAccess: false,
    });
    renderPanel();

    expect(
      await screen.findByText('You do not have permission to manage access.'),
    ).toBeTruthy();
    expect(api.listGrants).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Give access' })).toBeNull();
  });

  it('does not search principals until 3 characters are typed', async () => {
    renderPanel();

    const input = await screen.findByLabelText('search principals');
    expect(
      screen.getByText('Type at least 3 characters to search'),
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: 'on' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.listPrincipals).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'onb' } });
    await waitFor(() =>
      expect(api.listPrincipals).toHaveBeenCalledWith({
        projectId: 'project',
        search: 'onb',
      }),
    );
  });

  it('shows an empty state when nothing matches', async () => {
    api.listPrincipals.mockResolvedValue({ data: [] });
    renderPanel();

    fireEvent.change(await screen.findByLabelText('search principals'), {
      target: { value: 'zzz' },
    });

    expect(
      await screen.findByText('No users or groups match your search'),
    ).toBeTruthy();
  });

  it('reads manage rights for the folder being shown', async () => {
    renderPanel({ projectId: 'project', folderId: 'folder-1' });

    await screen.findAllByTestId('access-grant-row');
    expect(api.getEffectiveAccess).toHaveBeenCalledWith({
      projectId: 'project',
      folderId: 'folder-1',
      flowId: undefined,
    });
  });

  it('shows an in-place error when grants fail to load', async () => {
    api.listGrants.mockRejectedValue(new Error('boom'));
    renderPanel();

    expect(await screen.findByText('Trouble loading {entity}')).toBeTruthy();
  });
});
