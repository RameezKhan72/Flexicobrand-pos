> **v1.5 Full Catalogue Import:** Use **Website Catalogue → Choose Shopify CSV → Preview CSV → Import All Products from CSV**. See `SHOPIFY_FULL_CATALOGUE_IMPORT_V1_5.md` for the official Shopify Products export steps. No live catalogue is bundled; actual product records require Shopify export or API.

# FLEXICO POS v1.3 — Cream & Gold Testing Release Candidate

**Start with [RELEASE_V1_3.md](RELEASE_V1_3.md) for this version; [docs/ENCRYPTED_BACKUP.md](docs/ENCRYPTED_BACKUP.md) for optional encrypted vault.** All original v1.2 features are preserved, but the project is not approved for real-money production use.

---

# Flexico POS v1.2 — Mobile/PWA + Android build source

**Start here:** [MOBILE_AND_RELEASE_GUIDE.md](MOBILE_AND_RELEASE_GUIDE.md). This folder contains the working local POS, a mobile responsive/PWA shell, Android Studio source, and a GitHub Actions workflow to compile a debug APK. **No APK binary has been generated in this environment, no live integrations are validated, and mobile does not support independent offline sales.**

---

# Flexico POS v1.1 Storefront Edition (Release Candidate)

**New:** website catalogue import and website-inspired premium UI. Start with [STOREFRONT_EDITION_GUIDE.md](STOREFRONT_EDITION_GUIDE.md) for setup, variant prices, stock safety and acceptance limits. This release does **not** contain a pre-imported verified live Shopify catalogue; use admin Catalogue → Preview/Import from an internet-connected store PC.

---

# FLEXICO POS — v1.0 Release Candidate (RC1)

**14 November 2026 · Local-first cashier + optional PostgreSQL cloud owner mirror**

> **NOT YET APPROVED FOR COMMERCIAL GO-LIVE.** Workflows and UI are implemented for a single store PC; cloud deployment has not been validated against an actual managed PostgreSQL database and external services are not enabled. The software is provided for supervised testing, with test sales and test data. See `GO_LIVE_CHECKLIST.md`.

## 1. What is inside

### Local Windows POS (works even without internet if Node server + PC stay running)

- Login, roles and hashed passwords; local admin / manager / cashier / warehouse / support
- Dashboard, products and variants, photos, barcode labels, CSV import/export
- Two locations (store and warehouse), stock counts/adjustments/transfers, low-stock alerts
- Checkout: promotions, coupons, held bills, split payments, cash change, COD 10% advance, receipts
- **New: optional customer pay-later (layaway)**: owner can enable, manager can create sale for a registered customer; Receivables page lists due balances and records later collections with unique retry-safe ID; cash collections require an open cash shift
- Customer profiles, returns, quarantine, store-credit ledger, serial-number warranty and claims
- Suppliers, purchasing, received stock, supplier payments, cash shifts, COD and delivery tracking
- Day sales reports, audit logs, local SQLite backups and 80 mm print styles
- **New: local sync status** with pending sales and operational snapshot queue

### Optional remote owner cloud portal (read-only)

- PostgreSQL receiver accepts idempotent immutable sale events
- Durable operational snapshots include sales, remaining balances, returns, COD statuses, stock, warranty claims, purchase payables, low stock and stock product listing (up to 200 displayed)
- **New: separate owner username + password** in cloud environment, HttpOnly session cookie; cloud bearer sync token never goes to browser
- Cloud accepts only one enrolled device UUID per store ID to reject accidental second-device registration
- Cloud portal: `/owner/` (after deployment), responsive dashboard, sales, stock, COD, returns, data freshness warning
- Local POS remains the **only inventory source of truth**. Remote owner can **view**, not edit. This is NOT multi-terminal online/offline stock sync.

## 2. Windows installation and testing

**Requirements:** Windows 10/11, Node.js **22.13+**, a modern Chrome/Edge browser. No local npm install required.

1. Stop the previous Flexico server (`Ctrl+C`).
2. Back up **the entire old `data` folder and `public/uploads` folder**. Keep original copies untouched. Do not try the upgrade on the only copy of real shop data.
3. Extract this release into a NEW directory, such as `C:\Flexico_POS_v1_RC`.
4. For an upgrade, copy old `data/` contents and `public/uploads/` into the new extracted project. Do not copy older source files over the new code.
5. Double-click `start-windows.bat`. Go to `http://localhost:3147`.
6. Sign in; check product counts and past receipts before creating any new bills.
7. To use pay-later: **Settings → Enable customer credit**, save; select a customer and **Customer credit / pay later** from the sale-type dropdown (manager/admin). Go to **Receivables** for later collection.
8. To test cloud queue, check **Integrations** and verify that pending events stay safe with internet disconnected.

**Local security:** the server deliberately binds to `127.0.0.1` by default. Don't change `HOST` to `0.0.0.0` without implementing a secure network deployment with HTTPS, access controls and authenticated terminals.

**No encrypted backups by default.** Database backups are saved under `data/backups`, and product photos are in `public/uploads`; copy both to your external backup system. Keep those files and `data/` out of Git/source-code uploads.

## 3. Configure a staging cloud (optional, not a completed deployment)

Read **`cloud/README.md`** and **`GO_LIVE_CHECKLIST.md`**.

- Deploy `cloud/` to an HTTPS Node host with managed PostgreSQL.
- Provide `DATABASE_URL`, `CLOUD_SYNC_TOKEN` (32+ random chars), `CLOUD_STORE_ID`, `CLOUD_OWNER_USERNAME`, and `CLOUD_OWNER_PASSWORD` (12+ chars) in secure environment settings.
- On local Windows CMD set the *same* `FLEXICO_CLOUD_TOKEN` and `FLEXICO_STORE_ID`, and `FLEXICO_CLOUD_SYNC_URL=https://YOUR-HOST/v1/events` before running `start-windows.bat`.
- Log into `https://YOUR-HOST/owner/` with the **separate owner username/password**. Never give owner the sync token.
- Physical cloud account provisioning, DNS changes, certificates and Postgres validation were NOT performed for this release.

## 4. Test suite

`run-tests-windows.bat` or `npm test` runs **8 automated tests** in `tests/`. Verified on Node 22.16:

- Core local POS API transactions, roles and reports
- Professional workflows, returns, warranty, purchasing, cash shifts and backups
- Cash overpayment/change and prior database migration
- Offline outbox retry/deduplication
- Customer credit, partial collections, duplicate-payment defense
- Operational snapshots queue/retry/deduplication
- Owner login/read-only access without exposing cloud token

Mock browser rendering of Receivables and Cloud Owner Dashboard was checked in Chromium with no JS page errors. Mock images are previews, not live screenshots from a real hosted service.

## 5. Not delivered / pending external acceptance

**NOT LIVE:** Shopify API stock/products/orders; FBR certified invoicing/QR; Leopard courier booking; WhatsApp Business messages; card/wallet payment acquiring. These need provider accounts, requirements approval and staging/production credentials. Local receipts clearly say TEST RECEIPT / NOT AN FBR TAX INVOICE. Do not use them in place of legally required certified invoices.

**NOT SAFE FOR MULTI-STORE INDEPENDENT OFFLINE DEVICES:** Only one local device is authoritative. Cloud is a read-only projection, not a bi-directional inventory database. Multiple cashier browsers on the same local server are not the same thing as multiple disconnected SQLite instances.

**NOT PRODUCTION-VERIFIED:** managed PostgreSQL deployments and restore drill; secure offsite encrypted backup, 80 mm device and barcode scanner tests, hardware power-loss drill, external integration validations, load/security audit, operation monitoring, on-site staff acceptance, regulatory approval.

## 6. Data ownership and maintenance

Main database path: `data/flexico.sqlite` (override with `FLEXICO_DB`). The SQLite file is **not encrypted**, so restrict OS accounts and drive permissions. Backups can contain sensitive customer data. `data/.gitignore` exclusions prevent accidental distribution in ZIP, but are not an encryption substitute. The server is intended to remain running on the store PC; closing the terminal stops checkout.

Start with `TEST_PLAN.md` for actual client-side walkthroughs.
