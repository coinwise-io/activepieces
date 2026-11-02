---
icon: 👤
---

# SCIM

SCIM 2.0 provisioning lets an identity provider (JumpCloud, Okta, Azure AD) create, update and deactivate platform users and groups. This is the MIT implementation in this fork, written from scratch after the Enterprise one was removed. Base URL is `/api/v1/scim/v2`. Auth is a **SCIM token** sent as a Bearer token.

**SCIM token** — a `scim_…` secret a platform admin generates under Authentication → SCIM provisioning. Only its sha256 hash is stored (`scim_token`), and the plaintext is shown once. The token decides the platform for every request.
**User group** — a group provisioned by the IdP (`user_group` plus `user_group_member`). It is the unit the RBAC project grants permissions to. It is not a project.

### Mapping
- **SCIM User → AP `User`.** The SCIM `id` is `user.id`, and `userName` is the lowercased email.
- **Identity on create.** A new identity is verified, with provider `SAML`.
- **`active` → `UserStatus`.** DELETE deactivates the user instead of removing it.
- **SCIM Group → `user_group`.** `members` are user ids of the same platform.

### Gotchas
- **SCIM never touches platform admins.** Requesting `platformRole` ADMIN returns 400, and any change to an existing ADMIN returns 400 `mutability`. Admins are managed in the app, so a leaked token cannot escalate.
- **Identities are global and shared across platforms.**
  - Create reuses an identity only if no other platform uses it, or its email is in this platform's verified SSO domain.
  - Name and email edits are refused on a shared identity.
  - An email change bumps `tokenVersion`, which kills existing sessions.
- **With a verified SSO domain, `userName` must be in it.**
- **PUT without `active` keeps the current status.** It does not reactivate.
- **SCIM routes use PUT and PATCH, unlike the rest of the API.** RFC 7644 requires it. The plugin has its own `application/scim+json` parser and its own error handler that returns SCIM error bodies.
- **Bounds:** `count` is at most 200, `startIndex` at most 1,000,000, and a group request takes at most 1000 members. Member writes are chunked by 500.

## Key files
- `packages/server/api/src/app/identity-provisioning/` — `identityProvisioningModule`, the SCIM plugin, token and group services
- `packages/core/shared/src/lib/management/identity-provisioning/` — admin API schemas
- `packages/core/shared/src/lib/ee/scim/` — SCIM wire schemas (MIT)
