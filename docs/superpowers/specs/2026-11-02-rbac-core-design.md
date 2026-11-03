# RBAC core: access grants on projects, folders and flows

Project 2 of the coinwise-io access-control roadmap. Project 1 (SSO + SCIM) brought users and groups in from JumpCloud. This project lets those users and groups be given access to flows. Two-person approval (project 3), write-only secrets (project 4) and authenticated triggers (project 5) build on it.

All code here is new and MIT. The Enterprise project-role implementation that was removed from this fork is not used as a reference.

## Intent

Control who can see, run and change each flow and what hangs off it (runs, logs, connections, variables). Access is given to a person or to a group, and on a single flow, a folder, or a whole project.

The motivating case: compliance flows are built and owned by the compliance team, but run by the support or onboarding teams. Run history is visible to the people who own the flow and to people explicitly allowed to audit it. Someone who runs a flow sees the result of their own run.

## Roles

A grant gives one role on one scope to one principal.

| Role | Can do on the flows in scope |
|---|---|
| **Editor** | Everything: read and change flows, publish and enable or disable them, see and retry every run, manage connections and variables of the project, and manage the grants of that scope. |
| **Executor** | See that the flow exists, run it, and see the runs they started. Cannot change the flow or see other people's runs. |
| **History reader** | See the flow and every run of it, read-only. |

Roles add up. Someone in two groups gets both groups' roles. A grant on a project covers every folder and flow in it. A grant on a folder covers every flow in the folder.

Platform admins and the owner of a project keep full access, as today. Platform operators keep editor access on every project, as today. Platform members only get what a grant gives them, plus their personal project.

## Decisions

- **One table, explicit columns.** `access_grant` has `projectId` (required), `folderId` and `flowId` (optional), `userId` or `groupId` (exactly one), and `role`. The scope is the narrowest id that is set. Each id is a real foreign key with `ON DELETE CASCADE`, so deleting a flow, folder, project, user or group removes its grants with no clean-up code. (my call; a single polymorphic `resourceId` would have needed manual clean-up.)
- **Executors see their own runs in full.** "The result of their own run" is the whole run they started, including step output. "Full history" means other people's runs, which needs editor or history reader. Masking secrets in step output is project 4. (my call)
- **Executors can read the flow definition.** They need to see what they are about to run, and the definition holds no secret values, only connection references. (my call)
- **Narrow grants give a narrow project view.** A member with grants only on some flows can open the project and sees only those flows and their runs. Project-wide pages (connections, variables, tables, agents, settings) need a project-scope grant. The exception is editors at folder or flow scope: they can list and pick the project's connections and variables to build their flows, and create new ones. Project 4 makes those values write-only. (my call)
- **Who manages grants.** Platform admins, the project owner, and editors whose scope covers the target (a folder editor can grant on that folder and its flows). Grantees must belong to the same platform. Project 3 will lock grant changes on published flows behind two-person approval.
- **Executing is a new permission, `EXECUTE_FLOW`.** In this project it guards the in-app ways to start or retry a run and MCP flow tools. Forms and webhooks start enforcing it in project 5, together with system users.
- **No custom roles.** Three fixed roles cover the requirements. Custom roles can come later without changing the table.

## How it is enforced

1. **Project access.** `projectAccess` resolves a member's role in a project from their grants. A project-scope grant maps to a project role (editor → the existing Editor permission set plus `EXECUTE_FLOW`; history reader → read-only; executor → read flows, execute, read own runs). A member with only narrower grants gets a limited role: flow and run permissions, which the flow and run services then narrow per flow.
2. **Project list.** Members also see the team projects where they hold any grant, directly or through a group.
3. **Flows.** Listing returns only flows the caller can see. Reading needs any role on the flow. Changing, publishing, enabling, moving or deleting needs editor on the flow. Creating needs editor on the project, or on the target folder.
4. **Runs.** Listing returns every run of flows where the caller is editor or history reader, plus the runs the caller started (`flow_run.triggeredBy`) on flows where they are executor. Reading one run follows the same rule. Retrying needs editor, or executor on their own run.
5. **Folders.** Members see folders that hold a flow they can see, or that they have a grant on. Creating, renaming and deleting folders needs editor on the project.
6. **MCP.** MCP tokens are issued per user through OAuth, so every MCP call carries the person who connected the client (for example the Claude connector). The same rules apply there: a person only sees as tools the flows they may run, running one needs `EXECUTE_FLOW` on that flow, the run is recorded as started by them, and project-wide tools need a project-scope role. Projects without a grant cannot be selected. MCP calls without a user get no flow execution or writes until system users arrive in project 5. (added at the user's request)
7. **UI.** The web app asks the server for the caller's effective permissions in the current project, and for each flow, and gates buttons and pages with them. Today `checkAccess` always answers yes in this edition; it starts answering for real.

## Managing access

- API under `/v1/access-grants`: list the grants of a project, folder or flow; create one; delete one; and get the caller's effective roles for a project or a flow.
- UI: an "Access" dialog on a flow (builder and flows table) and on a folder, and an "Access" page in project settings. Each lists the grants, adds a user or a group with a role, and removes a grant.

## Not covered here

- Two-person approval of grant changes and publishing on published flows (project 3).
- Write-only secrets and masking in logs (project 4).
- Enforcing `EXECUTE_FLOW` on forms and webhooks, and system users (project 5).
- Tables, agents and knowledge bases get no per-item grants. They stay project-wide.
