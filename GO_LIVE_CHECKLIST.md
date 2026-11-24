# Flexico POS — v1.0 Commercial Go-Live Gates

Status: **BLOCKED — release candidate, not production approved**. Sign-off is required for every critical gate.

## Stage A — Functional UAT

- [x] Local checkout and receipt flow automated tests
- [x] Discount, split payment, cash change, COD 10% advance automated tests
- [x] Returns, warranty, supplier purchasing, shifts and audit workflow automated tests
- [x] Customer credit/receivables and collection idempotency automated tests
- [x] Local sales and operational snapshot queue tests with mock receiver
- [x] Owner portal mock login/session test and visual smoke test
- [ ] Actual client acceptance across all forms, products and printer/scanner hardware
- [ ] Staff training and real test-day cash reconciliation sign-off

## Stage B — Cloud and data integrity

- [ ] Paid Node hosting account, TLS ingress and separate PostgreSQL service provisioned
- [ ] Cloud owner's independent account/secret provisioned and safely stored
- [ ] Cloud Postgres migration tested on staging, including upgrade rollback plan
- [ ] Cloud read-only owner dashboard verifies live operational updates, stale warnings
- [ ] Device registration / loss & rotation procedure approved
- [ ] Cloud health checks, uptime monitoring, alerting, logs and secret rotation implemented
- [ ] Backup: encrypted offsite SQLite database + product photos; restoration trial performed
- [ ] Staging network outage, power loss (UPS recommended) and long offline recovery tested
- [ ] Resource/performance test for business dataset and >=10 client/browser sessions
- [ ] Third-party security assessment for auth, session, CSRF, input validation, dependency audit
- [ ] Only ONE authoritative local store database is allowed in this architecture

## Stage C — External integrations (NOT IMPLEMENTED)

- [ ] Shopify store owner authorizes Admin API credentials and webhook subscriptions
- [ ] Shopify variant/SKU/location ID mapping and inventory source-of-truth policy
- [ ] Shopify orders imported idempotently; stock conflict and reconciliation drill
- [ ] FBR/PRAL licensed integrator determines applicability and integration protocol
- [ ] Invoicing and QR validation implemented and tested with official integration/sandbox
- [ ] Leopard courier business API credentials, test shipments and COD reconciliation
- [ ] WhatsApp Business API approval, verified templates, consent and delivery status
- [ ] Bank/card/wallet provider settlement checks where applicable

## Stage D — Commercial acceptance

- [ ] Owner signs off SRS, taxes, return/warranty terms and user permissions
- [ ] Data migration from Shopify/current lists, deduplication and stock physical count
- [ ] Thermal receipt, warranty, label print and financial report approval
- [ ] Written support / SLA / issue escalation / backup owner agreed
- [ ] Client representative authorizes production sales launch

**Never report this RC as fully FBR-compliant, live Shopify-synced or multi-terminal cloud POS.**
