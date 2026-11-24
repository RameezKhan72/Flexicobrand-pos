# FLEXICO POS v1.5 — Catalogue Import QA

Build date: 2026-11-24

## Automated tests
- Full `npm test` run #1: **27 of 27 passed**.
- Full `npm test` run #2: **27 of 27 passed**.
- Tests include: Shopify CSV parsing, image-only rows, draft filtering, quoted newlines, exact variant pricing (PKR), compare-at prices, idempotent imports, stock preservation, manual SKU collision protection, upgrade from CSV to real Shopify variant IDs, real authenticated local HTTP CSV import and repeat, plus legacy POS billing and security regression suites.

## Known limitations
- Actual full live Shopify feed could not be retrieved from this build environment. No real product files are preloaded. Production product count and prices still require merchant's Shopify export or live API access on the merchant's Windows POS.
- Physical Shopify stock is NOT imported. New product stock is zero. Images are remote until cached.
- No production Shopify order/inventory two-way synchronization, FBR, courier, or WhatsApp integration claims.
- Not a completed commercial production launch; staging and physical device tests remain necessary.

See `SHOPIFY_FULL_CATALOGUE_IMPORT_V1_5.md` for how to populate the POS.
