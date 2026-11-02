---
title: Two-factor (TOTP)
icon: 🔑
---

# Two-factor (TOTP)

The second factor for sessions that do not come from SAML. MIT code written for this fork; JumpCloud still owns MFA for SSO sign-ins. Design: `docs/superpowers/specs/2026-11-01-break-glass-totp-design.md`.

**Break-glass account** — an account whose email is outside the SSO domain. It keeps password sign-in even when email sign-in is off, and must use TOTP.
**MFA challenge** — what a first-factor endpoint returns instead of a session: `{ mfaRequired, challengeToken, enrollmentRequired }`. Lives 5 minutes in Redis, single use, burned after 5 wrong codes.
**Recovery code** — one of 10 single-use codes (`xxxxx-xxxxx`) shown once at enrollment, stored as HMAC.

### When it is asked
- The user has TOTP on → a code at every non-SAML sign-in.
- Otherwise, SSO is active on the platform → enrollment before the first session.
- Otherwise → nothing, so plain self-hosted installs need no setup.

### Gotchas
- **Every session goes through `mfaService.issueSession`.** A new sign-in path that calls `authenticationUtils.getProjectAndToken` directly skips the second factor.
- **TOTP is per user, so per platform.** One person on two platforms enrolls twice. Switching platform into one that requires TOTP is refused with `MFA_REQUIRED`.
- **First enrollment trusts whoever has the password.** Enroll break-glass accounts as soon as SSO is turned on.
- **Codes cannot be replayed.** `lastUsedStep` keeps the last accepted 30 s step, and only newer steps pass. Tests that sign in twice need the next step's code.
- **Attempts are counted before the check.** Redis `INCR` runs first (5 per challenge, 10 per user in a fixed 15-minute window), so parallel guesses cannot slip past the limit. The flip side: anyone with the password can lock the real user out of TOTP for that window.
- **Enabling, disabling or resetting TOTP ends every session of that person** (rotates `tokenVersion`), so a stolen session does not survive it. The web signs the user out after enable and disable.
- **An enrollment never replaces an existing one.** A second confirm returns 409, so a parallel challenge cannot swap in another authenticator.
- **`AP_ALLOW_OPEN_SIGN_UP=true` plus SSO** lets anyone with an outside-domain email sign up with a password, protected only by first enrollment. Keep it off.
- **Lost device and lost codes** → another platform admin resets it (`DELETE /v1/authentication/mfa/users/:userId`). Admins cannot reset themselves.

## Key files
- `packages/server/api/src/app/authentication/mfa/` — `mfaService`, `totp`, `userMfaService`, challenge store
- `packages/server/api/src/app/authentication/sso-policy.ts` — what "SSO active" means
- `packages/web/src/features/authentication/components/mfa/` — sign-in challenge and enrollment
- `packages/web/src/app/components/account-settings/` — self-service two-factor
