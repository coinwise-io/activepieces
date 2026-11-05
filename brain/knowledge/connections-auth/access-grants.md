---
icon: 🗝️
---

# Access Grants

Role-based access for platform members, written from scratch for this fork (the Enterprise project roles are gone). A platform ADMIN, the project owner and a platform OPERATOR keep what they had. A platform MEMBER sees only their personal project plus what a grant gives them. Users and groups come from SCIM, see *scim*. Design: `docs/superpowers/specs/2026-11-02-rbac-core-design.md`.

**Access grant** — one row in `access_grant`: one role on one scope for one principal (a user or a group). Roles add up across a user's own grants and the grants of every group they belong to.
**Role** — `EDITOR` (everything on the scope, plus managing its grants), `EXECUTOR` (sees the flow incl. its definition, runs it, sees only runs they started, `flow_run.triggeredBy`), `HISTORY_READER` (sees the flow and all its runs, read-only).
**Scope** — the narrowest id set: `FLOW` (`flowId`), `FOLDER` (`folderId`), else `PROJECT`. A project grant covers every folder and flow, a folder grant every flow in it. A flow grant stores `folderId = null`, because flows move between folders and the folder is read at check time.
**Narrow grant** — a folder or flow grant. A member holding only narrow grants gets a limited project permission set, and every flow, run and folder endpoint narrows per flow.
**Unrestricted** — ADMIN, owner, OPERATOR, SERVICE and ENGINE principals. They skip all narrowing.

### Permissions
- **Project scope:** EDITOR gets the Editor permission set (now incl. `EXECUTE_FLOW`). HISTORY_READER gets read of project, flows, folders, runs. EXECUTOR gets the same reads plus `EXECUTE_FLOW`.
- **Narrow scope:** read of project, flows, folders, runs. A narrow EDITOR also gets flow write, status, run write, execute, connections and variables (read and write), so they can build. A narrow EXECUTOR also gets `EXECUTE_FLOW`.
- Everything else (tables, agents, MCP, knowledge base, alerts, settings) needs a project-scope grant.

### Who manages grants
ADMIN, owner, OPERATOR and an EDITOR whose scope covers the target (a folder editor manages that folder and the flows in it, not the project). Principals must belong to the project's platform. Grants only exist on TEAM projects.

### API (`/v1/access-grants`)
`GET /` (grants that apply to a project, folder or flow, with `scope` and `principal`), `POST /` (201, duplicate is 409), `DELETE /:id`, `GET /effective` (caller roles, permissions, `canManageAccess`), `GET /principals?search=` (users and groups of the platform, 50 of each).

### Gotchas
- **Resolution is cached per principal object.** `projectAccess.resolveForPrincipal` memoizes on the request's `principal` (a `WeakMap`), so authorization and the handler share one grants query. Never reuse a principal object across requests.
- **Membership-only routes are not safe once a member can hold a narrow grant.** Any route with `permission = undefined` passes for anyone with any role. Sample data, trigger events, test trigger, test step and flow versions now check the flow through `accessGuard`. Add a check there when you add a route that takes a flow id.
- **Inactive or removed users resolve to no access.** `accessResolver.resolve` returns null for a non-ACTIVE user and checks platform membership before ownership, so a removed owner of a team project stays locked out. MCP `authenticate` and `refreshAccessToken` re-check status and platform on every call, and `userService` revokes all MCP OAuth grants on deactivation (incl. SCIM `active=false`), delete and removal. Removal also deletes the user's `access_grant` and `user_group_member` rows.
- **Non-editors run only the published flow.** The `MANUAL_TRIGGER_RUN_STARTED` websocket event passes `restrictToPublished` to `startManualTrigger` unless the caller has EDIT on the flow: the version must be `publishedVersionId`, the flow ENABLED and the trigger the manual piece trigger. MCP flow tools run `LOCKED_FALL_BACK_TO_LATEST`, and a disabled flow answers 404.
- **Sample data must belong to the flow.** `getOrReturnEmpty` returns nothing when the file metadata `flowId` differs from the flow version's, so a step cannot point at another flow's sample file.
- **Squatting guard for narrow editors.** Creating a connection `externalId` or a variable name is denied when a draft or published version of a flow they cannot EDIT references it (`hiddenReferenceGuard`; connections via `connectionIds`, variables via a regex over the version's trigger JSON). Project-scope editors skip the check.
- **Grant changes that happen indirectly still refresh sockets.** CHANGE_FOLDER, folder delete and flow delete call `refreshAccessForProject`.
- **Restricted callers cannot self-grant and cannot browse principals.** Anyone who is not unrestricted or a project-scope EDITOR may not grant to themselves or to a group they belong to, and `/principals` matches only an exact email or exact group name for them. Folder `numberOfTables` is 0 without project-scope `READ_TABLE`.
- **Folder create, rename and delete use `WRITE_FLOW`**, which a narrow editor holds, so those routes assert project-scope EDITOR explicitly.
- **Retry is gated by `EXECUTE_FLOW`**, not `WRITE_RUN`. An EXECUTOR may retry only their own runs. Retry on the latest version keeps `triggeredBy` of the original run so the executor still sees the result.
- **Run events are split by room.** Sensitive websocket events (run progress, step progress and results) go to `<projectId>:run-viewers` plus the user room of whoever started the run, never to the whole project room. Only unrestricted users and project-scope EDITOR or HISTORY_READER join `run-viewers`. A narrow-only member gets live progress for runs they started and polls otherwise. Presence, locks and draft-updated events still use the project room (ids only).
- **`getAllForUser` ignores grants unless `includeGrantedProjects: true`.** The project list, the sign-in project pick and MCP project selection pass it. Analytics does not.
- **MCP follows the same roles.** `mcp-permissions.ts` resolves the user's access per call. Unrestricted users keep every tool. A member gets only the permissions of their project-scope grants for static tools, so a narrow editor is denied tables, connections and building tools (like the REST H1 rule). The one exception is `READ_RUN` for narrow-only members: `ap_list_runs` and `ap_get_run` narrow like the REST runs, so they stay usable. `ap_resolve_property_options`, `ap_resolve_property_chain`, `ap_list_ai_models` and `ap_validate_step_config` need project-scope EDITOR because they run pieces with project connections. The in-app chat uses the same checker.
- **MCP flow tools list only flows the user may run** (EXECUTOR or EDITOR on the flow, folder or project, also via groups), re-checked when the tool is called. The run records `triggeredBy = userId`: sync runs pass it to `flowRunService.start`, async runs park the user id in Redis (`webhook-run-owner`, 10 minutes) and `submitPayloads` reads it back when the worker creates the run. A connection with no user id gets read-only tools and no flow tools.
- **Websocket access is re-evaluated on change.** Grant create or delete, SCIM group changes (membership or delete) and user status, role, delete or removal from the platform call `websocketService.refreshAccessForProject` or `refreshAccessForUsers`, which fix the project, run-viewers and per-flow `resource:<id>` rooms or disconnect the socket. Every user socket also joins `<projectId>:member-sockets`, because narrow-only members are not in the project room and a refresh by project would miss them. Sockets of narrow-only members join a flow room only after a READ check on JOIN_PRESENCE or LOCK_RESOURCE. Sensitive events (lock, presence-write, run start) re-resolve the user's access on every event.
- **Hidden means 404.** A flow, run or folder the caller has no role on answers 404, so ids do not leak. 403 is for a caller who can see it but lacks the role.
- **Narrow editors only create connections and variables.** Update, revalidate, replace, delete and reveal need project-scope EDITOR, and creating a connection with an existing `externalId` counts as an overwrite.
- **Engine tokens stay project-wide (known limit).** A flow built by a narrow editor runs with an engine principal that is bound to the project, not to a flow or to the builder. Through it the flow can reach, across the whole project: tables, records and fields, store entries, variables (worker route), connections by name (`app-connection-worker`), sub-flows and flow versions (`engine-controller`), waitpoints, knowledge bases, AI providers and model tiers, and the project (`project-worker`). Narrowing this needs system users (project 5).
- **Webhooks and forms are not narrowed.** They start enforcing `EXECUTE_FLOW` in project 5.
- **Unique indexes are partial, one per scope and principal kind**, so NULL folder or flow ids do not defeat uniqueness and the entity matches the migration with no drift.
- **No application events yet.** `ApplicationEventName` lives in `core/shared` and has no access-grant entry, so grant changes are only logged.

## Key files
- `packages/server/api/src/app/access-control/` — entity, `accessPolicy` (pure rules and SQL narrowing), `accessResolver`, `accessGuard`, grants service and controller
- `packages/server/api/src/app/project/project-access.ts` — `resolveForPrincipal`, `assertPrincipalAccessToProject`
- `packages/server/api/src/app/core/websockets.service.ts` — socket access snapshot, `toRunViewers`
- `packages/core/shared/src/lib/management/access-grant/` — request and response schemas
