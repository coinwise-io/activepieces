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
- **Folder create, rename and delete use `WRITE_FLOW`**, which a narrow editor holds, so those routes assert project-scope EDITOR explicitly.
- **Retry is gated by `EXECUTE_FLOW`**, not `WRITE_RUN`. An EXECUTOR may retry only their own runs. Retry on the latest version keeps `triggeredBy` of the original run so the executor still sees the result.
- **Run events are split by room.** Sensitive websocket events (run progress, step progress and results) go to `<projectId>:run-viewers` plus the user room of whoever started the run, never to the whole project room. Only unrestricted users and project-scope EDITOR or HISTORY_READER join `run-viewers`. A narrow-only member gets live progress for runs they started and polls otherwise. Presence, locks and draft-updated events still use the project room (ids only).
- **`getAllForUser` ignores grants unless `includeGrantedProjects: true`.** Only the project list and sign-in project pick pass it. MCP and analytics do not, so a granted member does not reach MCP (which does not enforce roles) or analytics through a grant.
- **Webhooks, forms and MCP are not narrowed.** They start enforcing `EXECUTE_FLOW` in project 5.
- **Unique indexes are partial, one per scope and principal kind**, so NULL folder or flow ids do not defeat uniqueness and the entity matches the migration with no drift.
- **No application events yet.** `ApplicationEventName` lives in `core/shared` and has no access-grant entry, so grant changes are only logged.

## Key files
- `packages/server/api/src/app/access-control/` — entity, `accessPolicy` (pure rules and SQL narrowing), `accessResolver`, `accessGuard`, grants service and controller
- `packages/server/api/src/app/project/project-access.ts` — `resolveForPrincipal`, `assertPrincipalAccessToProject`
- `packages/server/api/src/app/core/websockets.service.ts` — socket access snapshot, `toRunViewers`
- `packages/core/shared/src/lib/management/access-grant/` — request and response schemas
