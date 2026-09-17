# Background Alarms (Web Push) — setup guide

Alarms now work **even when LifeOS and the browser are closed** on Android
(Chrome/Edge) and desktop, via Web Push. One-time setup required on your
Supabase project.

## How it works

1. The app stores each device's push subscription in `push_subscriptions`.
2. A Supabase **Edge Function** (`send-push`) runs **every minute** (pg_cron).
3. It queries due reminders, task alerts (with lead time), and routine alarms,
   then sends a Web Push per device.
4. The service worker shows a **max-importance notification** with a long
   vibration pattern and the system notification sound — even when the app and
   browser are closed. Tapping it opens LifeOS.
5. If the app *is* open, the push also triggers the (louder) in-app WebAudio alarm.

## One-time setup

### 1. Generate VAPID keys

On your machine:

```bash
npx web-push generate-vapid-keys
```

(Any node one-liner works; you need one Public and one Private base64url key.)

### 2. Put the keys where they're needed

- **Client:** add to your Vercel environment (and `.env` locally), then redeploy:
  ```
  VITE_VAPID_PUBLIC_KEY=<public key>
  ```
- **Edge Function secrets:**
  ```bash
  supabase secrets set VAPID_PUBLIC_KEY=<public key> VAPID_PRIVATE_KEY=<private key>
  ```
  (If you don't use the CLI: Supabase dashboard → Edge Functions → your
  project's secrets UI can set the same names.)

### 3. Deploy the Edge Function

```bash
supabase functions deploy send-push
```

### 4. Run the SQL

Supabase dashboard → SQL Editor → paste **`supabase/migration-push.sql`** → Run.
This creates `push_subscriptions` + `alarm_fires` (with RLS), and schedules the
`lifeos-send-push` cron job (every minute).

> The cron function reads `project_url` and `service_role_key` from the Vault.
> If they're not present it logs a notice and skips (harmless). To add them:
> ```sql
> select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
> select vault.create_secret('<PROJECT_URL>', 'project_url');
> ```

### 5. Enable on each device

LifeOS → Settings → Notifications → **"Enable background alarms"** → allow the
permission → **"Send test alarm"** to verify.

## Notes & limits

- Android (Chrome) delivers these with the screen off / app closed. Desktop
  Chrome/Edge requires the browser process running (it starts with the OS).
- The push notification uses the **system notification sound** — the loudest
  option available to web apps with the app closed. The LifeOS alarm tone plays
  when you tap the notification (or if the app was already open).
- `alarm_fires` prevents duplicate pushes; old rows are pruned daily.
- A test push goes only to *your own* devices (the function verifies the JWT).
