# LifeOS — Android wrapper (Trusted Web Activity)

Wraps the deployed LifeOS PWA (https://life-os-tdl.vercel.app) into a real
Android APK/AAB using **Bubblewrap** — no Android Studio required; the tooling
downloads the Android SDK pieces automatically.

## One-time setup

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://life-os-tdl.vercel.app/manifest.webmanifest
```

- `init` asks for a **keystore password** twice — remember it (it signs your app).
- It reads the PWA manifest and generates the project.

> **Digital Asset Links (required for the URL bar to disappear):** publish this
> file on the site — `https://life-os-tdl.vercel.app/.well-known/assetlinks.json`
> — containing the SHA-256 fingerprint of your keystore and the Android package
> name. Bubblewrap prints the exact JSON you need and can deploy guidance; until
> it's published the app works but shows a thin URL bar.

## Build the APK

```bash
bubblewrap build
```

Outputs:
- `app-release-signed.apk` — install directly on your phone
- `app-release-bundle.aab` — upload to Play Store if you ever want to

## Install on your Android phone

1. Copy `app-release-signed.apk` to the phone (USB, Drive, whatever).
2. Tap it → allow "Install unknown apps" for that source when asked.
3. Open **LifeOS** from your launcher — full screen, no browser UI.
4. Sign in once; sync + alarms behave exactly like the PWA (it IS the same site,
   same service worker, same notifications — just packaged).

## Update the app

The wrapper always shows the live site, so deploying a new build to Vercel
updates the app automatically — no APK rebuild needed for content changes.
