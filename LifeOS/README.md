# LifeOS — Native Wrappers (Android + Windows)

This folder contains **app wrappers** around your deployed LifeOS PWA
(https://life-os-tdl.vercel.app). Nothing in the parent repo was changed —
the website, its code, and its deploys are untouched.

Why wrappers? Your alarms, sync, service worker, and notifications all live on
the website. Wrapping means **zero duplicated logic**: whatever works in the
browser works identically in the apps, and every Vercel deploy updates both
apps automatically.

```
LifeOS/
├── desktop/   Electron app for Windows (installable exe)
└── android/   Trusted Web Activity APK via Bubblewrap
```

## Windows (desktop/)

```bash
cd desktop
npm install          # downloads Electron (one time)
npm start            # run it now, window opens with LifeOS inside
npm run dist         # build installers into desktop/dist/
```

Build outputs:
- `dist/LifeOS Setup <ver>.exe` — normal installer (Start menu, uninstaller)
- `dist/LifeOS <ver>.exe` — portable single-file exe, just run it

Behavior:
- Closes to the **system tray** — alarms/notifications keep working after you
  press X (real quit is tray → Quit)
- Power-save blocker keeps alarm timers reliable
- External links open in your real browser

## Android (android/)

See `android/README.md`. Short version:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://life-os-tdl.vercel.app/manifest.webmanifest
bubblewrap build     # → app-release-signed.apk
```

Copy the APK to your phone and install it. No Android Studio needed.

## Alarms in the wrappers

- **Android:** push notifications (the `send-push` Edge Function setup in
  `../supabase/PUSH_SETUP.md`) ring even when the app is closed — same as the PWA.
- **Windows:** the app keeps running in the tray with the in-app alarm scheduler
  active, so alarms ring while the machine is on. For true "PC is off" alarms,
  the OS itself must be on (any app has this limit) — push notifications arrive
  the moment the PC wakes and the app launches.
