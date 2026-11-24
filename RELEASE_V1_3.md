# FLEXICO POS v1.3 — Cream & Gold Hybrid Testing Release Candidate

**19 November 2026 — intended for supervised testing, not production authorization.**

This build continues from **v1.2**. Existing SQLite data is compatible. It still uses a **single authoritative Windows/local POS server**, with an optional PostgreSQL **read-only** owner cloud mirror. The Android source connects to a configured HTTPS server; it is NOT an independent offline cashier app.

## What changed in v1.3

1. New warm **dark-cream + champagne-gold** theme across login, dashboard, POS, product/catalogue, management screens and cloud owner portal (includes reduced-motion accessibility preferences). The appearance of the POS now follows the client's cream/gold brand identity, not the older dark-green concept.
2. New-install defaults include the approved FLEXICO phone `0315-9517966`, email `support@flexicowatches.com`, website `https://www.flexicowatches.com` and supplied office address. **Existing settings are NOT overwritten** during upgrades. Owners can edit website/email/phone/address in Settings.
3. Normal test receipts and gift/warranty receipt views include updated brand categories, contact options and/or web address, while retaining **TEST RECEIPT / NOT AN FBR TAX INVOICE** safeguards. Printer output is still subject to 80mm hardware acceptance.
4. `tools/secure-vault.js` adds password-protected **SQLite online snapshot + product photo** vault, AES-256-GCM + scrypt, integrity verification, and restoration to a *new* directory. This is an opt-in tool, **NOT automatic offsite backup**. Read `docs/ENCRYPTED_BACKUP.md` before using.
5. Dedicated regression tests for brand/settings and encrypted backup/restore. Android build project preserved; no native APK compiled in this release.

## Windows setup

1. **Safeguard the old entire project folder first.** Stop v1.2.
2. Copy the old `data/` and `public/uploads/` folders to a secure separate backup location (don't overwrite original). **Do not copy v1.2 code over v1.3.**
3. Extract this v1.3 archive into a NEW directory and copy only the backed-up data/upload folders into the matching v1.3 locations.
4. Double-click `start-windows.bat`, then open `http://localhost:3147`.
5. Sign in. Under Settings, confirm the correct physical store address and tax rate (website may list another public store address). Existing shop settings are preserved.
6. Run `run-tests-twice-windows.bat` or `npm test`. Tests use temporary databases, not your live shop database.
7. Use **Website Catalogue → Preview** to review the live products/variant prices, then Import only when the store has confirmed SKU mapping and local stock counts. Import keeps local stock unchanged.

## What remains blocked for commercial release

- Live deployment with managed PostgreSQL, tested HTTPS ingestion, monitoring, backup restoration and a tested recovery plan
- Shopify Admin app authorization, safe *bi-directional* order / inventory sync, webhook verification, conflict policy, online order idempotency and physical stock reconciliation
- FBR-authorized tax invoice integration and official QR generation; tax defaults are **not** tax guidance
- Leopard booking API and COD settlement, WhatsApp Business receipt/message templates and customer consent
- Physical 80mm receipt/card/label print testing, barcode scanner, cash drawer, mobile browser and Android package acceptance
- Formal independent security audit, staff acceptance tests, at-scale tests, business owner sign-off

**Stock safety policy:** offline store POS is the master. Cloud mirror is view-only. Do not install two independent offline store databases, and do not enable Shopify quantity writes until Admin API credentials, Shopify location IDs and compare-and-swap/idempotency handling have been validated.

See also `GO_LIVE_CHECKLIST.md`, `TEST_PLAN.md`, `cloud/README.md`, and `docs/ENCRYPTED_BACKUP.md`.
