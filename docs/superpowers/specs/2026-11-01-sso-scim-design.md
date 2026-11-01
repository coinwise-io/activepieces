# SSO (SAML 2.0) and SCIM 2.0 provisioning

Project 1 of the coinwise-io access-control roadmap. The later projects are the RBAC core, two-person approvals, hardened secrets, and authenticated triggers.

## Intent

Users sign in through the company identity provider, JumpCloud. JumpCloud also provisions users and groups automatically. The groups created here are the foundation the RBAC project grants permissions to.

## Hard constraint: written from scratch

The Activepieces Enterprise implementation of SSO and SCIM was removed from this fork and must not be used as a reference. That covers git history and upstream. Only MIT code may be reused: the existing web screens, the `@activepieces/shared` schemas (including `lib/ee/scim`, which is MIT), and the MIT server modules. Third-party libraries already in the API package may be used, for example `samlify`.

## Goals

- **SAML 2.0 SP-initiated login** against any SAML IdP, tested with JumpCloud. Users are provisioned by SCIM or invited, then sign in with SSO.
- **SCIM 2.0 server** for Users and Groups (RFC 7643 and RFC 7644). It must cover the subset JumpCloud uses: create, read, list with `filter=userName eq` or `displayName eq`, replace, patch, and delete.
- **Platform admins can:**
  - configure SAML on the existing screen (`/platform/sso/saml`);
  - manage SCIM bearer tokens;
  - see the groups that SCIM provisioned.
- **Zero setup for self-hosters.** Nothing is enabled until an admin configures it, and no new env vars are introduced.

## Non-goals

- Granting permissions to groups. That belongs to the RBAC project.
- OIDC. JumpCloud supports SAML, which is enough for now.
- IdP-initiated login.
- Single logout.
- Group management outside SCIM. Groups are created by the IdP (the platform admin manages them in JumpCloud).

## Plan flags

`platformService` derives the plan from `OPEN_SOURCE_PLAN`, but with `ssoEnabled: true` and `scimEnabled: true`. The existing `PlanFeatureGuard` screens unlock. Checks that used to short-circuit on `ApEdition.COMMUNITY` now follow the platform settings instead. Those are `assertDomainIsAllowed`, `assertEmailAuthIsEnabled` and `getSignInMethods`.

## SAML contract (frontend already expects it)

The API is served under `/api`, and route prefixes below are relative to it.

| Route | Who | Behavior |
|---|---|---|
| `GET /v1/authn/saml/login?platformId=` | public | Redirects (302) to the IdP with an AuthnRequest. When `platformId` is omitted, uses the platform resolved for the request (`platformUtils`). `RelayState` carries the platformId. |
| `POST /v1/authn/saml/acs` | public, form-urlencoded | Validates the signed response against the stored IdP metadata and certificate. Reads email, first name and last name through `attributeMapping`, falling back to common attribute names. Calls `authenticationService.federatedAuthn({ provider: SAML, predefinedPlatformId })`. Stores the `AuthenticationResponse` in Redis under a random one-time code with a 60 s TTL, then redirects (302) to `${frontendUrl}/authenticate?code=<code>`. On failure, redirects to `${frontendUrl}/sign-in`. |
| `POST /v1/authn/saml/claim` `{ code }` | public | Consumes the code atomically and returns the `AuthenticationResponse`. Unknown or expired code returns 401. |
| `POST /v1/authn/saml/discover` `{ domain }` | public | Returns `{ platformId }` for a platform whose `ssoDomain` is verified and that has SAML configured, else `{ platformId: null }`. |
| `POST /v1/authn/saml/sso-domain` `{ ssoDomain }` | platform admin | Sets or clears the domain. Creates a pending TXT record `{ name: '_ap-sso-verification.<domain>', value: 'ap-sso-verification=<random>' }`. Returns `{ ssoDomain, ssoDomainVerification }`. |
| `POST /v1/authn/saml/sso-domain/verify` | platform admin | Resolves the TXT record over DNS. Marks the domain VERIFIED when the value matches. Returns the same shape. |

- **SP entity ID (audience):** `Activepieces`, a constant already shown on the setup screen.
- **ACS URL:** exposed through the existing `SAML_AUTH_ACS_URL` flag, as `${publicApiUrl}v1/authn/saml/acs`.
- **Saving the configuration:** goes through the existing `POST /v1/platforms/:id` with `federatedAuthProviders.saml = { idpMetadata, idpCertificate }`. The server validates the metadata before saving: it parses the XML, or fetches it when it is a URL, through `safeHttp`. The server also checks that the certificate is a valid X.509 PEM. Invalid input returns 400 with a message.
- **Why a one-time code:** a JWT in a URL leaks into browser history and proxy logs. The frontend `/authenticate` page is changed to POST the code to `/claim`.

## SCIM contract

- **Base URL:** `/api/v1/scim/v2`, shown to the admin as `${publicApiUrl}v1/scim/v2`.
- **Authentication:** `Authorization: Bearer <token>`.
  - Tokens look like `scim_<43 base64url chars>`.
  - Only the sha256 hash is stored, in the new table `scim_token`, scoped to one platform.
  - Every SCIM request resolves the platform from the token, and every query filters by that platformId.
  - A request that fails authentication returns a 401 SCIM error.
- **Content type:** request and response bodies are `application/scim+json`, and plain `application/json` is also accepted. Errors use the `ScimError` schema from shared.
- **Endpoints:**
  - `GET /ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`.
  - `/Users`: GET list (filter `userName eq`, `startIndex`, `count`), POST, and GET, PUT, PATCH, DELETE on `/:id`.
  - `/Groups`: the same operations, with `displayName eq` as the list filter.
- **Users:**
  - The SCIM `id` is the Activepieces `user.id`.
  - `userName` is the email, lowercased.
  - On create, an existing identity with that email is reused. Otherwise a verified identity is created with provider `SAML` and a random password.
  - The user joins the platform as MEMBER, or as the `platformRole` given in the custom extension schema.
  - `externalId` is stored on `user.externalId`.
  - `active=false` sets status INACTIVE, and `active=true` sets ACTIVE.
  - DELETE deactivates the user instead of removing it. That way flows the user owns survive, and the account can be reactivated.
- **Groups:**
  - The new tables are `user_group` (`id`, `platformId`, `displayName`, `externalId`) and `user_group_member` (`groupId`, `userId`), with a unique `(groupId, userId)`.
  - PATCH supports `add`, `remove` and `replace` on `members`, including path filters like `members[value eq "<id>"]`. It also supports `replace` on `displayName`.
  - Members must be users of the same platform. Unknown member ids return 400.

### Admin endpoints

All of these require a platform admin and `plan.scimEnabled`.

- `GET /v1/scim-tokens` → `ListScimTokensResponse`
- `POST /v1/scim-tokens` `CreateScimTokenRequest` → `CreateScimTokenResponse`. The plaintext token is returned only once.
- `DELETE /v1/scim-tokens/:id` → 204
- `GET /v1/user-groups` → `ListUserGroupsResponse`. Read-only. It uses a single query and no N+1.

The schemas live in `@activepieces/shared`, in `lib/management/identity-provisioning`.

## Security decisions (from the review)

- **SAML fails closed.** A login is accepted only when the platform has a VERIFIED `ssoDomain` and the asserted email is in that domain, on every edition. Without this, the admin of one platform could assert any email and reach that identity's other platforms.
- **Responses are bound to a request.** `/login` stores the AuthnRequest ID in Redis together with a browser nonce, sent as an HttpOnly, SameSite=Lax cookie. The ACS then requires:
  - InResponseTo matches a stored request (this means IdP-initiated logins are refused);
  - the platform comes from the stored request;
  - Destination equals the ACS URL;
  - each assertion ID is used only once.

  `/claim` requires the nonce cookie, which blocks login CSRF.
- **SCIM never grants or touches platform admins.**
  - Asking for ADMIN is refused.
  - Existing admins cannot be modified, deactivated or deleted through SCIM.
  - Admins are managed in the app.
- **SCIM does not edit identities shared with another platform.**
  - Names and email can only be changed when the identity belongs solely to this platform.
  - With a verified domain, `userName` must be in that domain.
  - An email change revokes existing sessions.
- **Out of scope (single-platform installs):** domain squatting, where a pending claim blocks other platforms.

## Frontend

- **`/authenticate`:** accepts `?code=`, claims it through `/v1/authn/saml/claim`, then saves the response. The `?response=` branch is removed.
- **SSO page:** gets a new "SCIM provisioning" section. It shows the base URL, lists tokens, creates a token and shows it once with a copy button, and revokes tokens.
- **Groups page:** a new read-only "Groups" page in platform admin that lists groups with their members.

## Database

- **New blocking migration:** creates `scim_token`, `user_group` and `user_group_member`, with FKs to platform and user (`ON DELETE CASCADE`) and indexes on `platformId`.
- **Entity registration:** the new entities are added to `getEntities()`.

## Testing

- **Integration tests (CE suite):**
  - SCIM token CRUD and auth, including a revoked token and a cross-platform token.
  - Users and Groups CRUD with the JumpCloud-style PATCH payloads.
  - SAML: config validation, login redirect, ACS with a response signed by a test key pair, claim being one-time use, discover, and domain verification with a mocked DNS lookup.
- **Repo checks:** `npm run lint-dev`, typecheck, and the full CE suite.
