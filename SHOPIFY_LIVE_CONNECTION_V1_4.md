# FLEXICO POS v1.4 – Official Shopify app connection (READ-ONLY phase)

## What this release supports

The POS can use **Shopify Dev Dashboard client credentials** to automatically fetch 24-hour Admin API access tokens without manually entering fresh tokens. This uses read_products scope only and retrieves active products, variants, images, prices, SKUs, and descriptions from the 2026-10 GraphQL Admin API. Import does **not** modify Shopify prices or stock and does **not** fetch orders. It never overwrites local stock. Legacy Admin API tokens (apps created before January 1, 2026) remain supported.

**This package is unconnected until the client creates/installs the app in their own Shopify organization.** No credentials are included and real FLEXICO live-store import is not yet verified.

## Create app and install

1. Sign in to the actual FLEXICO Shopify admin as owner/app developer. Shopify Admin -> Settings -> Apps -> Develop apps -> Build apps in Dev Dashboard.
2. Create an app named `FLEXICO POS Connector` in the **store owner's Shopify organization**.
3. On Versions: configure App URL `https://shopify.dev/apps/default-app-home` (API-only app), Webhooks API version 2026-10, and minimum scope `read_products`. Release version. Do not request write_products / write_inventory / write_orders yet.
4. Install the app on the FLEXICO store, review permissions. Verify the actual store is in the SAME Shopify organization as the custom app. For cross-organization agencies, client credentials cannot be used: build OAuth instead.
5. In app Settings, locate **Client ID** and **Client secret**. Keep the secret private. Find the store's canonical `*.myshopify.com` hostname (not flexicowatches.com).

## Configure on Windows (temporary testing session)

Open Command Prompt **inside** the extracted Flexico POS project. Substitute only your actual values, without quotes inside the values:

```bat
set "SHOPIFY_STORE_DOMAIN=store-name.myshopify.com"
set "SHOPIFY_CLIENT_ID=REPLACE_WITH_CLIENT_ID"
set "SHOPIFY_CLIENT_SECRET=REPLACE_WITH_SECRET"
start-windows.bat
```

Never paste the real secret in email, screenshots, GitHub, ChatGPT or customer-facing code. Environment variables used this way persist only in this Command Prompt process; the secret is visible to anyone with privileged process access. For production, configure machine/service-managed secrets in a secure administrator-controlled environment. Any screenshot for troubleshooting must hide secrets.

The POS exchanges the credentials for an access token on the server, caches it only in memory, refreshes it ahead of expiration, and retries once on HTTP 401. If the app and store aren't in the same organization, Shopify may return `shop_not_permitted`; use the correct owner-owned app or implement OAuth rather than copying a token from another store.

**Legacy only:** For older Admin-created custom apps, use `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_TOKEN` instead. Don't add both methods unless migrating intentionally.

## Import / verify

1. Back up `data` and `public/uploads` with the POS stopped.
2. Start the POS from the configured Command Prompt and sign in as admin.
3. Open Website Catalogue; confirm Admin connection mode in API status, then click Preview Website Catalogue. Verify product and variant counts and compare a sample of actual prices on flexicowatches.com.
4. Only after checking the preview, click Import / Update Prices. New variants have zero local stock until verified.
5. Cache images for offline use, confirm 5-10 real products/variants in POS, then test a checkout in a test environment.

## Not implemented / go-live blockers

- Shopify webhooks & order synchronization, inventory pushing, location mapping, conflict resolution, tax/FBR, courier integrations are NOT live.
- The POS is configured so the local store inventory remains master. Shopify stock MUST NOT be updated until location and channel rules, idempotency and compare-and-swap protections, and staging validation are implemented.
- Shopify Admin queries include active products and may include unpublished products; filter visibility or review records before import.
- Product variants over 100 for a product will reject the import rather than silently truncate it; expand pagination before using for a very large catalogue.
- The local API importer is manually invoked. It isn't scheduled yet.

## Troubleshooting

- `SHOPIFY_STORE_DOMAIN`: must be `store.myshopify.com`, not `flexicowatches.com`.
- `HTTP 401`: check client credentials and installation; if retry fails, reauthorize or rotate secret.
- `HTTP 403` / scope errors: verify `read_products` was granted by the store.
- `shop_not_permitted`: app and store are in different Shopify organizations; client credentials do not work across them.
- No products returned: check app installation and product status, then try the preview again.
- Never share API keys/tokens/secrets when troubleshooting.

Official docs: https://help.shopify.com/en/manual/apps/install-setup-apps and https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
