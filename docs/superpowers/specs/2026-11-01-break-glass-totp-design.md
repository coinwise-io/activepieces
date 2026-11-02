# Break-glass password sign-in and TOTP two-factor

Complements the SSO + SCIM design (`2026-11-01-sso-scim-design.md`). Written from scratch under MIT; no Enterprise code was consulted.

## Intent

Once SAML is on, the company domain signs in through JumpCloud, but the platform still needs accounts that work when the IdP is down or misconfigured (break glass) and accounts for people outside the company domain. Those accounts sign in with a password, so they need a second factor that the IdP would otherwise provide.

## Rules

**SSO active** means: SAML configured **and** `ssoDomain` set **and** its DNS verification is `VERIFIED`.

### Who may use a password (or emailed code)

| Platform state | Email in SSO domain | Email outside SSO domain |
| --- | --- | --- |
| SSO active | only if `emailAuthEnabled` | always |
| SSO not active | only if `emailAuthEnabled` | only if `emailAuthEnabled` |

So with SSO active, turning off "email sign-in" forces the company domain onto SSO while break-glass accounts on another domain keep their password. `enforceAllowedAuthDomains` still applies on top: a break-glass domain must be in that list when the list is enforced. Invitation-only sign-up is unchanged.

### When TOTP is required

TOTP is checked on every session obtained with a first factor other than SAML/JWT (password sign-in, password sign-up into an existing platform, emailed code, Google):

- the user has TOTP enabled → must enter a code;
- otherwise, the platform has SSO active → must enroll now, before getting a session;
- otherwise → no second factor (unchanged behaviour, so plain self-hosted installs need zero setup).

SAML logins never ask for TOTP: JumpCloud owns MFA there. Switching platform into a platform that would require TOTP is refused with `MFA_REQUIRED`; the user signs in to that platform directly.

TOTP is stored **per user** (per platform), so a platform admin can reset it without touching other platforms.

## Flow

1. A first-factor endpoint returns either the usual `AuthenticationResponse` or `{ mfaRequired: true, challengeToken, enrollmentRequired }`.
2. Challenge: 32 random bytes, kept in Redis under its SHA-256 for 5 minutes, bound to `{userId, platformId, projectId}`. At most 5 wrong codes, then it is burned. Single use.
3. `enrollmentRequired` → `POST /v1/authentication/mfa/enroll` returns `{secret, otpauthUri}` (the secret is kept encrypted inside the challenge); `POST /v1/authentication/mfa/enroll/confirm {challengeToken, code}` stores TOTP and returns `{recoveryCodes, authentication}`.
4. Otherwise `POST /v1/authentication/mfa/verify {challengeToken, code}` accepts a 6-digit TOTP or a recovery code and returns the session.

Signed-in self-service (`/v1/authentication/mfa`): `GET /status`, `POST /setup`, `POST /setup/confirm`, `POST /recovery-codes` (regenerate, needs a current code), `POST /disable` (needs a current code).
Platform admin: `GET /users` (ids of enrolled users), `DELETE /users/:userId` (reset; not self, same platform only).

## Security decisions

- TOTP per RFC 6238: SHA-1, 6 digits, 30 s, ±1 step. Implemented with `node:crypto`, tested against the RFC vectors. A code's time step must be newer than the last accepted one (no replay inside the window).
- Secret: 20 random bytes, stored with `encryptUtils` (AES-256 with `AP_ENCRYPTION_KEY`).
- Recovery codes: 10 codes of 10 base32 chars, shown once, stored as HMAC-SHA256 keyed with the encryption key, each usable once. Consumption and replay checks run in a transaction with a row lock.
- Wrong code → `INVALID_OTP`; unknown, expired or exhausted challenge → `MFA_CHALLENGE_EXPIRED` (start over).
- All public MFA endpoints use the authn rate limit. Attempts are counted with `INCR` before the code is checked: 5 per challenge, 10 per user in a fixed 15-minute window.
- Enabling (self-service or forced), disabling and admin reset rotate the identity `tokenVersion`, which ends every existing session. An enrollment is insert-only; a second confirm returns 409 instead of replacing the authenticator.
- Forced enrollment is trust-on-first-use: whoever has the password enrolls. Enroll break-glass accounts as soon as SSO is turned on.

## Not covered

- Cloud-only paths that create a new platform during sign-up (`provisionOrOnboard`): a brand-new user has no TOTP and the new platform has no SSO, so nothing to check.
- WebAuthn / passkeys.
