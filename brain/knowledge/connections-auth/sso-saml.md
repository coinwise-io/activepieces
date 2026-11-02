---
icon: 🔐
---

# SSO (SAML)

SP-initiated SAML 2.0 sign-in against the company IdP, tested with JumpCloud. This is the MIT implementation in this fork, written from scratch after the Enterprise one was removed. The admin pastes the IdP metadata (XML or URL) on Authentication → SAML; the certificate is optional. Users are provisioned by [[scim]] or invited.

**SSO domain** — the email domain a platform proves it owns with a DNS TXT record (`_ap-sso-verification.<domain>`). SAML only works once it is VERIFIED.
**Login code** — a one-time, 60 s Redis code that the ACS hands to `/authenticate?code=`. The frontend exchanges it at `/v1/authn/saml/claim`, so no JWT ever sits in a URL.

### Flow
1. **`GET /v1/authn/saml/login`** stores the AuthnRequest id and a browser nonce in Redis, and sets the `ap_saml_nonce` cookie. It redirects when the IdP metadata offers HTTP-Redirect, otherwise it serves a self-submitting HTTP-POST form (JumpCloud metadata only offers POST).
2. **`POST /v1/authn/saml/acs`:**
   - verifies the signature against the stored certificate only;
   - checks InResponseTo, Destination, the audience (`Activepieces`), and that the assertion has not been replayed;
   - signs the user in through `authenticationService.federatedAuthn`.
3. **`POST /v1/authn/saml/claim`** requires the nonce cookie.

### Gotchas
- **SAML fails closed without a verified domain, on every edition.** The asserted email must be in that domain. Without this, an admin of another platform could assert any email and switch into that user's platform. The SSO button and `discover` follow the same rule.
- **IdP-initiated logins are refused.** A missing or unknown InResponseTo is rejected.
- **The certificate is pinned at save time.** Signatures are checked only against the saved certificate, never one carried in the response, which rules out self-signed assertions. If the admin leaves the certificate empty, the single signing certificate in the metadata is pinned; metadata with none, or with several, is refused.
- **No SP signing key.** Metadata that requires signed AuthnRequests is rejected at save time.
- **Metadata URLs are fetched once at save time** through `safeHttp`, https on every hop, with a 1 MB limit and a 10 s deadline. The fetched XML is what gets stored.
- **The Redis stores use MULTI GET+DEL, not GETDEL**, so Redis older than 6.2 still works.
- **CE follows the platform sign-in settings.** Turning email off is refused while it is the only working method.
- **"Email sign-in off" only binds the SSO domain.** While SSO is active, accounts on any other domain keep their password: that is how break-glass and external accounts work. Every password sign-in then needs a second factor, see [[mfa-totp]]. `enforceAllowedAuthDomains` still applies, so a break-glass domain must be on that list when it is enforced.
- **The Redis helper is shared.** `authTransientStore` (`authentication/lib`) backs both the SAML stores and the MFA challenges.

## Key files
- `packages/server/api/src/app/authentication/saml/` — `samlModule`, the service, config validator, and request/code stores
- `packages/web/src/app/routes/authenticate/` — claims the login code
- `packages/web/src/app/routes/platform/security/sso/` — admin screens
