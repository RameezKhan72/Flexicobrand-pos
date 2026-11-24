# FLEXICO POS v1.1 RC — Website Catalogue & Premium UI

## What is included

- Updated Flexico luxury watch visual identity throughout local POS, sign-in, dashboards and cloud owner portal: ivory, graphite, warm-gold accents, subtle movement, responsive styling, reduced-motion support.
- **Website Catalogue** screen in the admin POS with preview, import/update, last-run status and offline image caching.
- Shopify variant-aware catalogue import: title, brand, product type, description, tags, handle, option values, variant title, variant ID, SKU, barcode where published, sale price, compare-at price and approved product photos.
- Shopify price parsing correct for both public `/products.json` (decimal PKR strings) and Admin GraphQL (decimal PKR strings); avoids confusing these with AJAX/Liquid integer minor units.
- Idempotent upsert by Shopify variant ID: repeat imports do not duplicate products or alter stock quantities. Price changes append price history. SKU collisions do not alter locally-created products.
- Product details modal with options and source product link. Images can be cached to local PC, making them available while offline.

**This is a code release candidate, NOT proof the Flexico live catalogue has already been imported.** The importer has been exercised against controlled fixtures; internet access to Shopify's full product feed was unavailable from the build environment. The shop owner must authorize/connect the actual store on an internet-connected Windows installation and review real numbers before use.

## Windows installation

1. Back up the previous POS installation, especially `data/flexico.sqlite*`, `public/uploads`, local backups, and any connected secret configuration. Stop the old server before copying data.
2. Extract v1.1 into a **new folder**.
3. Copy previous `data` directory and `public/uploads` (if present) into the new folder. Do not mix running database files; close the old application first.
4. Install Node.js **22.13+** (22 LTS or later).
5. Double-click `start-windows.bat`. Open `http://localhost:3147`.
6. Admin login → **Website Catalogue** → **Preview website catalogue** → check total variants and prices → **Import / Update Prices**.
7. Open **Products**, search model names and inspect each variant's price, description and photograph.
8. Open **Inventory**, physically verify store/warehouse quantities and enter them by receiving or approved stock adjustment. **Newly imported products have 0 local inventory**, so the POS cannot accidentally sell uncounted stock.
9. While online, use **Cache next 80 product photos** repeatedly until no un-cached images remain. This caches images for offline use.
10. Test a low-value sale, receipt, tax rules, cash shift and cloud queue before allowing commercial use.

## Shopify catalogue access

By default the local POS reads the public `https://flexicowatches.com/products.json?limit=250&page=N` storefront feed. This gives **published website products and variants** when the store allows public JSON access. It does **not** provide warehouse quantities, actual costs, orders, customer data, private items or Shopify inventory accuracy. It uses public catalogue prices as displayed in the shop's base currency. This Flexico store is set to PKR in the SRS and website.

If the store blocks public JSON or you require more complete catalogue access, create a legitimate Shopify Admin custom app with **read_products** access (subject to Shopify's permission approval), configure the values securely as process environment variables **on the store PC**:

- `SHOPIFY_STORE_DOMAIN`: official `<shop>.myshopify.com` domain (not a random third-party URL).
- `SHOPIFY_ADMIN_TOKEN`: confidential custom app Admin API token.

The importer reads the Admin GraphQL API version `2026-10`, loads up to 100 pages of active products, and detects products with more than 100 variants instead of silently omitting those. This Admin path may include active products not published on the storefront; check these records. **Never send/store API tokens in chat, product data, screenshots, source control or browser localStorage.** Re-launch the POS after setting environment variables. The token is used on the server only.

**Note:** This is catalogue information import only, **not** production two-way Shopify orders and inventory synchronization. Correct inventory sync requires location mapping, transaction ownership rules, idempotency and recheck. FBR and courier/WhatsApp live APIs remain independently unconnected.

## Sync safeguards

- Preview has **no database changes**; import is an all-or-nothing local database transaction.
- Missing SKUs are generated from Shopify variant IDs; duplicate SKUs use fallback IDs rather than hijacking manual products.
- Stock is deliberately **never overwritten** by catalogue imports. New product store and warehouse stock both equal 0.
- Existing product photos uploaded directly by staff take precedence over Shopify image URLs.
- Sale records keep price snapshots; later web price changes don't retroactively change old receipts.
- Local data and catalog records remain available offline. Remote images are offline only after caching.
- Import fetch errors or malformed prices are surfaced; this tool does not silently replace incorrect values with zero.

## QA done in build environment

- Existing 8 POS integration tests retained.
- Four importer unit tests: price parsing, option mapping, import idempotency/stock preservation, SKU collision handling.
- One HTTP integration test with a controlled mock Shopify product JSON feed, covering preview → import → stock adjustment → repeat import.
- Headless browser mock validation of login, dashboard, catalogue and product navigation; no JavaScript errors. Previews use test data and are not screenshots of a production Shopify connection.

Run all tests with `npm test` or `run-tests-windows.bat`. **Real site API, live price verification, photo downloads, cloud PostgreSQL, Shopify order/stock sync, taxes, thermal hardware and actual deployment require acceptance testing with the client's own environment.**
