# Flexico Hybrid v1.0 RC1 — Quick Architecture Note

The Windows **store PC is authoritative for stock and all sales**. Cashier browser uses `localhost:3147`, which stays available when internet is interrupted, provided the PC itself has power and the Node process runs. SQLite WAL and synchronous=FULL are used for more durable local writes; backups, UPS and outage drills are still essential.

SQLite sale transaction commits a durable sale event in `sync_outbox`. Other business-table modifications increment a transactional version in `ops_sync_version` using SQLite triggers; a background worker materializes read-only snapshots into `ops_sync_outbox`. Each upload is acknowledged by PostgreSQL, with retry/backoff and idempotent UUID events. Old queued operational snapshots are superseded by the latest absolute state. Cloud uses version-aware projections.

The owner cloud portal shows the latest snapshot and explicitly warns if stale. It cannot make checkout or changes, nor does it do two-way Shopify reconciliation. It is a single device solution: **never run independent disconnected store databases for sales**.

Review `README.md`, `cloud/README.md`, `GO_LIVE_CHECKLIST.md`, and `TEST_PLAN.md` before client rollout.
