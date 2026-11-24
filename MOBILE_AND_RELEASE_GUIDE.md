# Flexico POS v1.2 — Mobile & Android build guide

This release is an incremental **testing candidate**, not a legally approved or fully deployed commercial POS. It preserves v1.1 local sales, payments, inventory, customers, credit, returns, warranty, Shopify catalogue import and cloud *read-only* owner mirror, and adds a more usable mobile UI and Android companion source.

## Which device works with which feature?

| Device | What it can run | Offline billing? |
|---|---|---|
| Store Windows 10/11 PC with Node.js 22.13+ | Local cashier server plus POS browser | **Yes**, while PC and its database are running, even if internet fails |
| Other Windows/macOS/Linux browser | Can use a properly secured reachable POS server | **No** if network to that server is lost |
| Android phone/tablet | Browser PWA after HTTPS deployment, or Android WebView companion APK built from `android-app/` | **No** if server is unreachable |
| iPhone/iPad | Browser/PWA after HTTPS deployment; **cannot** install Android APK | **No** if server is unreachable |

The Android project is **source only**. The current execution environment does not have Android SDK/Gradle/build tools and cannot download them. No `.apk` binary has been built or tested. Build it with Android Studio or the included GitHub Actions workflow, then validate on your target Android phones. The debug APK is for private testing, not Play Store/commercial distribution.

## Windows upgrade

1. Stop old POS; back up **both** old `data/` and `public/uploads/` in full, and ideally make a second external copy.
2. Extract v1.2 into a **new folder**. Never overwrite the original working code in place.
3. Copy the *old* `data/` and `public/uploads/` folders to the new v1.2 folder; keep the backups outside the app folder.
4. Run `start-windows.bat`. Login and confirm historic sales, stock and product photos before posting new sales.
5. Run `run-tests-twice-windows.bat` and review any failures. Tests use temporary databases, not your shop DB.
6. If trying the PWA, access via `http://localhost:3147` on the PC or **HTTPS** on a trusted deployed hostname. The service worker caches the **app shell only**, not sales; if the Node server is down the screen cannot process transactions.

## HTTPS server configuration for Android companion / other devices

The local cashier binds to `127.0.0.1` and rejects unexpected Host headers by default. Do not expose it directly to the public internet. First provision a trusted HTTPS reverse proxy with host firewall/security policies, TLS certificate and private/VPN access where possible.

To use a dedicated authorized host, set environment variables, for example (server-side configuration only):

```env
HOST=127.0.0.1
PORT=3147
FLEXICO_ALLOWED_HOSTS=pos.example.com
FLEXICO_ALLOWED_ORIGINS=https://pos.example.com
FLEXICO_PUBLIC_HTTPS=true
```

With a reverse proxy installed **on the same PC**, it can forward secure requests to `http://127.0.0.1:3147` while preserving the original `Host`. Do not set `HOST=0.0.0.0` or open port 3147 to the internet just to access it on a phone. The proxy must enforce HTTPS. Set `FLEXICO_PUBLIC_HTTPS=true` only for HTTPS-proxied deployment (sets session cookies to `Secure`). Replace example domains with an approved address. Use a private-network VPN for store devices and restrict portal access.

## Android build

Instructions: `android-app/README.md`.

The generated debug APK requires Android 8.0+ (API 26), but device/browser/system WebView compatibility is not yet verified. After installation, open the app and enter the **HTTPS** POS URL. It does not contain a local Node database, so entering a cloud *owner* portal URL gives a read-only view, not a cashier system. Never publish an unprotected local POS port.

## Web app install

- On Android Chrome, visit the HTTPS POS URL and choose **Install app** / **Add to Home screen** (if browser offers it).
- On supported iPhone Safari versions, use **Share → Add to Home Screen**.
- The UI stores no cached API result or local transactions in the service worker. Offline shell visibility is not equivalent to offline billing.

## Pending requirements before full commercial v1.0 approval

- Hosted cloud Postgres integration and authenticated cashier API deployment tested end-to-end (current hosted owner mirror has no write-capable cashier API).
- Real Shopify Admin GraphQL products/variant/stock/order two-way sync, location mapping, webhook signatures, reconciliation and duplicate-safe retries. Public website importer is **one-way product info**, not stock sync.
- Actual FBR invoicing approval/onboarding, certified integration where required, tax logic, QR/receipt validation.
- Leopard courier account/API and COD reconciliation; WhatsApp Business approved sender/templates.
- Encrypted external backups, independent restore drill, incident monitoring, load/security review, multi-device conflict testing.
- Real Android APK compile/install with signed release build; real 80mm thermal printer and barcode scanner tests.

External service credentials or legal approvals cannot be manufactured by code. Do not treat tax test receipts as certified invoices or rely on unverified stock for real online orders.
