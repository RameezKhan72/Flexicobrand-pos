# FLEXICO POS v1.4 — QA Summary

- Integration scope: Shopify Dev Dashboard client-credentials authentication for same-organization merchant custom app, plus existing legacy Admin token support.
- Preserved functionality: v1.3 POS sales, inventory, returns, receivables, offline queue, vault backups and UI.
- Shopify Admin GraphQL API version: 2026-10.
- Initial permissions: `read_products` only.
- Token handling: POST OAuth token endpoint on the server; keep access token in memory; renew before expiry; single retry on API HTTP 401; do not put secrets in UI, project files, logs, or local storage.
- New tests: token request, expiry renewal, concurrent deduplication, error recovery, permission checking, legacy compatibility, mocked Admin GraphQL preview & local import preserving zero physical stock.
- Full automated suite: 22 / 22 passed, first run; 22 / 22 passed, second run, Node 22.16.0.
- Live FLEXICO Shopify store authentication and import: NOT TESTED; owner app installation and real credentials required.
- Write inventory / order synchronization, FBR and courier integrations: NOT IMPLEMENTED. No production cutover approval implied.
