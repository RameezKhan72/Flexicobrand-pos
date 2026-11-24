# Flexico POS v0.4 — Manual Acceptance Checklist

Tick these on the Windows PC. Record screenshots and expected/actual results for each failure.

- [ ] Initial setup works with an admin password >=10 chars; reopening requires login.
- [ ] Wrong password is rejected; a cashier cannot open Admin/Audit/Settings pages.
- [ ] Add/edit/archive a product; attach JPG/PNG/WEBP photo; CSV export/import; barcode label preview.
- [ ] POS product search and scanner Enter; quantity, discount, coupon, customer, split payment.
- [ ] Test a full cash sale: receipt is created once, stock deducted once and revenue reported correctly.
- [ ] Test paid sale **without sufficient store stock**: rejected, no negative stock.
- [ ] Test COD order **below 10% advance**: rejected. At/above 10%: order created with due balance.
- [ ] Test Hold Bill -> Saved Bills -> Resume -> checkout; check price/stock revalidated.
- [ ] Create supplier + PO; receive; warehouse stock increases; second receive rejected.
- [ ] Record supplier part payment; overpay rejected.
- [ ] Return a single item once; refund amount, quarantine stock, and customer credit verified.
- [ ] Exchange using store credit toward a replacement sale; second credit redemption rejected.
- [ ] Warranty created on sale; serial number saved; claim workflow moves received->inspected->repaired->returned.
- [ ] COD order: manual verification, courier reference, remittance; remaining balance becomes zero.
- [ ] Open and close cash shift, compare expected drawer cash with physical count.
- [ ] Physical stock count: finalize variance; stale snapshot should not overwrite changed stock.
- [ ] Receipt print preview and physical print on the **actual 80 mm thermal printer**.
- [ ] Barcode label scans reliably with the **actual scanner**.
- [ ] Audit log includes important stock, discount, refund, purchase and user actions.
- [ ] Backup created, copied to external storage, and **restored on a separate test copy**.
- [ ] Verify browser responsiveness at laptop desktop width and on a small screen.

## External services — not ready, do not test as "live"

- [ ] Shopify Admin API/Webhooks and scheduled reconciliation — requires authenticated connection, mapping and test store.
- [ ] FBR invoice validation/QR — requires official onboarding, exact tax rules and certification.
- [ ] Leopard booking and live status — requires provider credentials and sandbox/live validation.
- [ ] WhatsApp Business delivery and templates — requires approved business account.
- [ ] Actual payment capture/settlement/reversal — requires supported payment provider.
- [ ] Full multi-device remote access, two-way product/stock sync, and cloud backup — separate development and security work. **v0.4 implements only durable sale-event queue and a cloud mirror API.**

**Result of automated tests:** execute `run-tests-windows.bat` or `npm test`. The automated suite exercises core API workflows but **does not validate external integrations or actual devices**.

## New v0.3 payment acceptance checks

- [ ] Create a Rs 2,499.00 cash sale and enter Cash = Rs 3,000.00. See CHANGE TO RETURN = Rs 501.00 (green).
- [ ] Create a split bill: Bank Transfer = Rs 244.91, Cash = full bill total. Change must equal Rs 244.91, and the printed receipt must show this amount.
- [ ] Type lower cash amount; Remaining balance must increase live. Non-COD sale with remaining amount must be blocked; COD allows remaining only after 10% advance and customer selection.
- [ ] Enter too much Bank Transfer/Card/Wallet/Store Credit; POS must reject without producing cash change.
- [ ] Reopen a successful receipt: cash received, change, net applied and remaining balance still show correctly.
- [ ] Open a shift and record overpaid cash sales. The expected cash on closing must match only actual cash kept after returning change.
- [ ] Existing v0.2 database migration retains products, customers, invoices and cash balances (test on a copy first).

## Hybrid v0.4 additional tests

- [ ] Open Integrations as admin: Cloud Sync shows **Not Configured** by default, with a pending count. Cashier cannot access admin-only integration page.
- [ ] Make a sale with internet disconnected (PC and local Node server must stay on); receipt works and Pending increases.
- [ ] Stop/restart the local POS, log in and confirm queued count remains the same.
- [ ] For a developer staging cloud, set HTTPS sync URL, store ID and token before Windows launch. New sale uploads and Pending decreases only on real cloud acknowledgment.
- [ ] Interrupt network while queued sales sync; reconnect and verify one mirrored sale event, not two.
- [ ] Repeat the same checkout client_request_id; verify only one local sale / one cloud event.
- [ ] Restore a **copy** of an older v0.3 DB, upgrade and confirm old sales queued once only.
- [ ] Test error handling: wrong cloud token, downtime, HTTP error; data remains local and retries safely.
- [ ] Verify owner cloud API is **not** misrepresented as complete accounting, current stock, current COD payments, or compliance.

## v1.0 RC1 — New acceptance checks

- [ ] In Settings, enable customer credit / pay later (admin-only). Cashier should not see the credit option; manager/admin should.
- [ ] Create a customer, create `Customer credit / pay later` checkout with partial cash and inspect Remaining Due.
- [ ] Receivables page lists that receipt, outstanding amount and customer.
- [ ] Collect a partial cash / bank payment on the receivable; balance should update. Repeat the same `collection_id` via API and verify no duplicate.
- [ ] Existing COD balances should also appear in Receivables; original COD reconciliation must not double count.
- [ ] Configure test cloud PostgreSQL and HTTPS, separate owner credentials. Log in to `/owner/`; verify latest sales, stocks, COD, returns, claim metrics.
- [ ] Make an offline purchase, return and COD collection; confirm last synced timestamp becomes stale and then catches up after reconnection.
- [ ] Attempt a second local UUID against the same cloud store ID; server should reject until an authorized device re-pairing.
- [ ] Verify owner is read-only and cannot use store sync bearer token to sign in to owner portal.
- [ ] Test broken cloud connection (local sales must still complete) and restore without duplicate sales.
- [ ] Conduct independent restore drill for BOTH SQLite backups and `public/uploads` photos.

**Implementation result:** 8 Node automated tests pass, Chromium mock UI preview has no JS errors. Hosted Postgres integration, real external APIs, Windows printer/scanner and security/load testing are still pending.


## v1.1 Website catalogue acceptance tests

1. Log in as admin. Open Website Catalogue; view status and preview actual website data.
2. Compare 10 random variant-specific prices with exact web product pages (not just the "From" price).
3. Import once, confirm titles/options/SKUs/photos, then import again and ensure product count remains constant.
4. Receive one physical watch into local store; resync catalogue. Verify quantity stays unchanged.
5. Confirm no unverified initial stock is inserted. Test scanned sale and offline operation.
6. Cache photos, disconnect internet and verify image cache displays while cashier works.
7. Test online API block case and authorized Shopify Admin connection.
8. Confirm existing v1.0 database and images survive upgrade.

**Recorded status:** only fixture-based import tests and UI mock tests passed in build environment. Real Shopify and hardware acceptance PENDING.
