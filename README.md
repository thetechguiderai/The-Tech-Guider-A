# The Tech Guider AI

The Tech Guider AI is a full-stack AI workspace with chat, model routing, conversations, plans, billing hooks, and an owner dashboard.

## Web development

```powershell
npm install
npm run dev
```

The local server runs on port 3000. Configure server-only secrets in a local `.env` copied from `.env.example`; never commit that file.

## Production URL

Set `TG_PRODUCTION_URL` to the HTTPS URL of the deployed web application (for example, the production Netlify URL). Desktop and Android release builds use this URL and must never use localhost. `APP_URL` remains the canonical server URL for OAuth callback construction.

## Windows MSI

```powershell
$env:TG_PRODUCTION_URL = "https://your-production-domain.example"
npm run desktop:msi
```

This creates a real x64 MSI in `release/`. The build-time script injects the non-secret production URL into the packaged Electron app. Development mode (`npm run desktop`) continues to run the local server.

Windows prerequisites: Node.js, npm, and the Electron/electron-builder dependencies installed by `npm install`. Building an MSI must be done on Windows.

## Android APK

The Android wrapper is generated with Capacitor and connects directly to the configured HTTPS production web app/API. It keeps web authentication in the hosted origin, including its secure cookie behavior.

```powershell
$env:TG_PRODUCTION_URL = "https://your-production-domain.example"
npm run android:sync
npm run android:build
```

The release APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

Android prerequisites: Android Studio, a compatible Android SDK/platform, Java 21 (or the version required by the generated Gradle wrapper), and `ANDROID_HOME`/Android Studio SDK configuration. If Gradle needs a signing configuration for distribution, configure it outside source control before publishing.

## Releases

Generated MSI/APK files, unpacked applications, Gradle output, local databases, and production URL injection files are ignored by Git. Host release artifacts in a real release service (for example GitHub Releases) before converting the site’s “Coming Soon” download controls into download links.
