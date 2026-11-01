---
icon: 🔐
---

# SSO (SAML)

SP-initiated SAML 2.0 sign-in against the company IdP, tested with JumpCloud. This is the MIT implementation in this fork, written from scratch after the Enterprise one was removed. The admin pastes the IdP metadata and certificate on Authentication → SAML. Users are provisioned by [[scim]] or invited.

**SSO domain** — the email domain a platform proves it owns with a DNS TXT record (`_ap-sso-verification.<domain>`). SAML only works once it is VERIFIED.
**Login code** — a one-time, 60 s Redis code that the ACS hands to `/authenticate?code=`. The frontend exchanges it at `/v1/authn/saml/claim`, so no JWT ever sits in a URL.

### Flow
1. **`GET /v1/authn/saml/login`** stores the AuthnRequest id and a browser nonce in Redis, and sets the `ap_saml_nonce` cookie.
2. **`POST /v1/authn/saml/acs`:**
   - verifies the signature against the stored certificate only;
   - checks InResponseTo, Destination, the audience (`Activepieces`), and that the assertion has not been replayed;
   - signs the user in through `authenticationService.federatedAuthn`.
3. **`POST /v1/authn/saml/claim`** requires the nonce cookie.

### Gotchas
- **SAML fails closed without a verified domain, on every edition.** The asserted email must be in that domain. Without this, an admin of another platform could assert any email and switch into that user's platform. The SSO button and `discover` follow the same rule.
- **IdP-initiated logins are refused.** A missing or unknown InResponseTo is rejected.
- **The certificate is pinned.** The IdP certificate comes only from the saved config, never from the response or the metadata. That rules out self-signed assertions.
- **No SP signing key.** Metadata that requires signed AuthnRequests is rejected at save time.
- **Metadata URLs are fetched once at save time** through `safeHttp`, https on every hop, with a 1 MB limit and a 10 s deadline. The fetched XML is what gets stored.
- **The Redis stores use MULTI GET+DEL, not GETDEL**, so Redis older than 6.2 still works.
- **CE follows the platform sign-in settings.** Turning email off is refused while it is the only working method.

## Key files
- `packages/server/api/src/app/authentication/saml/` — `samlModule`, the service, config validator, and request/code stores
- `packages/web/src/app/routes/authenticate/` — claims the login code
- `packages/web/src/app/routes/platform/security/sso/` — admin screens
