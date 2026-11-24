# Flexico Cloud Owner Mirror — v1.0 RC1 (Staging)

This is a **read-only cloud owner portal with PostgreSQL ingestion**. It complements the offline local Windows POS. It is **NOT** the central writable database for checkout/inventory, and has not been validated on a real managed PostgreSQL instance in this environment.

## 1. Hosting setup

1. Get a Node.js 22.13+ hosting service with HTTPS and managed PostgreSQL. Use the directory `cloud/` as the app root.
2. Build command `npm install --omit=dev`, start command `node server.js` (package includes `pg` dependency; installation needs network access).
3. Enter these **secret environment variables** in hosting provider settings:

   | Variable | Meaning |
   |---|---|
   | `DATABASE_URL` | Managed Postgres connection URL; private from browser |
   | `CLOUD_SYNC_TOKEN` | 32+ random secret, used ONLY for store-to-cloud uploads |
   | `CLOUD_STORE_ID` | `flexico-main` in first store |
   | `CLOUD_OWNER_USERNAME` | Unique owner name, minimum 3 chars |
   | `CLOUD_OWNER_PASSWORD` | Unique 12+ character password (recommend 16+) |
   | `NODE_ENV` | Set to `production` for Secure cookie |
   | `PORT` | Platform-provided port, or 4117 locally |
   | `HOST` | `0.0.0.0` on a managed host |

4. On startup `schema.sql` creates additive tables. Use dedicated credentials and restrict Postgres network access. Apply and verify DB migration on staging first.
5. Visit `/healthz`, then `/owner/` and sign in using the **owner login** (NOT the sync bearer token).
6. Local Windows Command Prompt before `start-windows.bat`:

   ```bat
   set "FLEXICO_STORE_ID=flexico-main"
   set "FLEXICO_CLOUD_SYNC_URL=https://YOUR-CLOUD-HOST/v1/events"
   set "FLEXICO_CLOUD_TOKEN=THE_SAME_SECRET_FROM_CLOUD_SYNC_TOKEN"
   start-windows.bat
   ```

7. Open **Integrations → Sync queued sales now** and then log in to `https://YOUR-CLOUD-HOST/owner/` to confirm real mirrored data.

## 2. APIs

- `POST /v1/events` — bearer sync token, max 25 immutable `sale.created`/`ops.snapshot` events. Transactionally acknowledges after PostgreSQL commit.
- `GET /v1/dashboard`, `GET /v1/sales` — bearer sync token; **internal integration APIs**, not browser-facing owner portal.
- `GET /owner/` — HTML login + read-only management portal.
- `POST /owner/api/login` — owner credentials from env, rate-limited; HttpOnly SameSite Strict cookie; `Secure` under NODE_ENV=production.
- `GET /owner/api/dashboard` — authenticated read-only combined sales and latest operational snapshot.
- `POST /owner/api/logout` — invalidates stored session.
- `GET /healthz` — health check, requires PostgreSQL.

A store ID is paired with the first device UUID that successfully syncs. A different UUID with the same token is rejected. Restoring a backup that preserves the UUID does **not** make it safe to use two independent tills; only run one authoritative local server.

## 3. Offline semantics and limitations

Sales are stored in local SQLite first. A durable sale event is written in the **same** transaction. Other operational tables mark an atomic dirty version through SQLite triggers; the worker converts the latest state to a snapshot and retries upload until acknowledged. Cloud can lag behind the store; old snapshots never overwrite a newer version.

The remote owner portal is read-only. Maximum 200 active products are shown as a stock sample, prioritized by low stock; summary metrics cover the whole local database. **No remote checkout, remote stock edits, multi-terminal reconciliation, FBR receipt registration, Shopify push or courier booking** is included here.

## 4. Security and operations required before production

- Enforce HTTPS at ingress; use secrets manager, IP/network restrictions, least-privilege DB role, automatic backups, and monitoring.
- Do not expose PostgreSQL, store-level bearer sync token, or POS local SQLite DB publicly.
- Add and verify operational runbooks, restore drills, CORS/CSRF review, stress testing, alerting, credential rotation and device enrollment/revocation on staging.
- In `NODE_ENV=production`, Secure cookies require HTTPS (expected behind hosting TLS termination).
- When replacing POS device, a DBA/administrator must explicitly reset/pair device after auditing data and rotating the sync token.
