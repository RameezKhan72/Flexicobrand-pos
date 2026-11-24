# Flexico POS v1.2 — Technical verification report

Test date: 16 November 2026. Test runtime: Node.js v22.16.0, on Linux test environment with temporary SQLite databases. No real customer data used.

## Regression run 1

Command: `npm test` — **15/15 subtests passed; 0 failed** (~5.1 sec).

## Regression run 2

Command: `npm test` — **15/15 subtests passed; 0 failed** (~4.9 sec).

## New checks added for v1.2

- PWA manifest and static image assets served by POS server.
- Service worker does **not** cache authenticated `/api/` routes.
- Host allowlist blocks unconfigured hostnames.
- Explicitly configured HTTPS reverse-proxy hostname accepted.
- Cross-origin and cross-site payment/login requests rejected.
- HTTPS-configured auth cookies include `Secure`, `HttpOnly` and `SameSite=Strict`.
- Android Studio source contains HTTPS-only validation, SSL-error rejection, mixed-content blocking and GitHub Actions APK build configuration.
- `node --check` completed for updated server and frontend JavaScript.

## NOT verified

- Android project was **not compiled or installed**; Android SDK, platform build-tools and Gradle are not present, and downloads were unavailable in this environment. An APK must be built on a machine/CI with the toolchain.
- Mobile and desktop browser screenshots/interactive QA were attempted but **blocked by the container browser's administrator URL restrictions** (`ERR_BLOCKED_BY_ADMINISTRATOR`). Therefore no claim of browser visual verification in this release.
- No current Shopify store authorization, managed PostgreSQL instance, FBR integration approval, Leopard API, WhatsApp Business credentials or physical printer was provided; these remain untested/not live.
- Tests use representative data and mocked integrations where appropriate; they are not security penetration testing, compliance certification, full load tests or store user-acceptance testing.

## Safe release classification

**Development/testing build. NOT a commercial go-live or a standalone Android offline cashier.** One Windows store PC is the single authoritative local inventory and billing source; remote owner cloud mirror is read-only.
