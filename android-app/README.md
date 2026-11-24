# Flexico POS Android Companion — build instructions

**This is Android source code, not a built APK.** The Gradle/Android SDK tools are required. It is a WebView companion for an existing **HTTPS-hosted** POS server and **does not embed Node.js, SQLite or an offline transaction database**. It will not sell offline when the server is unreachable. iPhone and Windows cannot run an APK.

## Make a test APK in GitHub Actions (no local Android SDK required)
1. Upload the *source project* to a private GitHub repository that you control, including hidden folder `.github/workflows`. Never upload `data/`, customer information, credentials, databases or backups.
2. Go to repository **Actions → Build Flexico Android test APK → Run workflow**.
3. When the build finishes successfully, open the run's **Artifacts** and download `FlexicoPOS-Android-DEBUG-APK`. Extract the archive to obtain `app-debug.apk`.
4. Install only on an approved test Android phone. You may have to allow installation from this source.
5. Open Flexico POS, enter the approved **HTTPS** POS endpoint, and log in with a regular POS account.

## Local Android Studio alternative
Open the `android-app` folder in Android Studio with an installed Android SDK (platform 35, build tools 35.0.0), JDK 17 and Gradle 8.11.1. Use **Build → Build APK(s)**. Debug APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.

## Limitations
- No HTTPS server has been provisioned or tested here, and the current Windows server is localhost-only by default.
- Using HTTP/LAN IP without TLS is intentionally blocked by the Android app. Set up a trusted reverse proxy and certificate before mobile use.
- Cloud owner portal is read-only, while offline cashier operations remain on the one store computer. Pointing Android to the owner cloud site gives owner-only functions, not checkout.
- The test build is debug-signed; for commercial distribution use your own private release signing key and verify device/hardware functions separately.
- Never publish private business data or production credentials in the GitHub source.
