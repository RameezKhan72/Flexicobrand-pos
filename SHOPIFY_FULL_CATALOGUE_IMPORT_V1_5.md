# FLEXICO POS v1.5 — Full Shopify website catalogue import

## Important status
This release contains **the tools to import all website products**, not a fabricated/preloaded list. The source ZIP contains NO live shop products or invented stock. The deployment/build environment cannot access `https://flexicowatches.com/products.json` reliably. To actually populate your POS, use either of the two methods below on your Windows PC.

## Best method — Shopify Products CSV export (complete, no app credentials needed)
1. Ask the FLEXICO Shopify owner to open **Shopify Admin → Products**.
2. Select **Export → All products → CSV for Excel, Numbers, or other spreadsheet programs**. Download the generated `products_export.csv` file. Do not edit prices in Excel (it can alter SKU/barcode/leading zeros). You need the FULL products export, not orders or inventory reports.
3. On your Windows store PC, back up your current `data/` and `public/uploads/` folders and close the previous POS.
4. Extract v1.5 into a separate folder; transfer the backed-up data folder and uploads folder. Launch `start-windows.bat`. Sign in as the Administrator.
5. Go to **Website Catalogue → Choose Shopify CSV**. Choose the exported `products_export.csv`.
6. Click **Preview CSV**. Verify count, sample product names, variant options and prices against Shopify Admin, including watches, gift boxes, fragrances and accessories.
7. Click **Import All Products from CSV**. It imports each active/published priced variant, category, vendor, description, handle, image URL, SKU and barcode when present.
8. Open **Products** to verify imported rows, then **Website Catalogue → Cache next 80 product photos** (repeat until complete while online).
9. Newly imported variants get **0 store and 0 warehouse stock**; use actual physical stock counts. Existing stock remains unchanged. Do not enable real store sales before verifying SKU, prices and quantities.
10. Export a new Shopify Products CSV and repeat when you need to refresh prices. The importer uses stable variant identity and avoids duplicates.

## Alternative — Live Shopify public/Admin catalogue
Use **Preview Website Catalogue** and **Import / Update Prices**. If the public `/products.json` endpoint is blocked, configure official Shopify Admin API credentials per `SHOPIFY_LIVE_CONNECTION_V1_4.md`. New Shopify app API credentials must be kept secret and configured on the store PC, never pasted into this chat.

## Safety and limitations
- Exported CSV inventory quantities are **not imported**. Physical stock levels require reconciliation, and no order, purchase or customer data is imported.
- This CSV loader excludes rows explicitly marked unpublished/draft/archived; it does **not** invent records absent from the export. You can request a separate draft-products import later.
- Shopify Admin Products CSV exports typically **do not include actual Shopify variant IDs**. The loader creates deterministic `CSV-...` IDs from product handle and options; when a later public/Admin API import returns the real ID, the product row is matched and promoted without duplicating it.
- If your export is larger than 15 MB, split by product group using Shopify's export filters; ask for guidance and avoid altering column headings. Larger catalogues should use Admin API pagination.
- Product photos are remote URLs until you use image cache. Unsupported/non-Shopify hosts are not downloaded automatically.
- Live Shopify orders, inventory writes, FBR and courier are **not** part of this import feature.
- The POS's `data/` directory is intentionally empty in the downloaded ZIP. We do not have the live Shopify product file nor credentials to prepopulate this package.

## Test it
`npm test` or `run-tests-twice-windows.bat`. The included tests verify price parsing, multiple options, image-only rows, duplicates, stock preservation and CSV-to-Shopify-ID upgrade.
