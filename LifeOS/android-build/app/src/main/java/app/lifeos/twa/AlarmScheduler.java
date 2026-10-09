package app.lifeos.twa;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import java.text.SimpleDateFormat;
import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives the web app's upcoming-alarm list through the JS bridge and
 * schedules each one with AlarmManager.setAlarmClock() — that API is
 * eligible to fire in Doze but requires exact-alarm access on Android 12+.
 * When access is denied we retain a best-effort inexact schedule. BootReceiver
 * can re-schedule everything after a reboot.
 */
public class AlarmScheduler {

    private static final String PREFS = "lifeos_alarms";
    private static final String KEY_PAYLOAD = "payload";
    private static final String KEY_SCHEDULED = "scheduled_keys";
    private static final String KEY_DISMISSED = "dismissed_keys";

    /**
     * Entry point from the JS bridge: payload = {sound, alarms:[{key,at,title,body}]}.
     * Returns a status JSON so the web app (and its Settings screen) can see
     * exactly what the native layer did — or the exact error if it failed.
     */
    public static synchronized String scheduleFromJson(Context ctx, String json) {
        try {
            JSONObject root = new JSONObject(json);
            JSONArray alarms = root.getJSONArray("alarms");
            // Validate the entire update before cancelling the previous snapshot.
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                if (a.getString("key").isEmpty() || a.getString("key").contains(",") || a.getLong("at") <= 0)
                    return "{\"ok\":false,\"error\":\"invalid alarm\"}";
                alarmTime(a);
            }
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return "{\"ok\":false,\"error\":\"no AlarmManager\"}";
            String mode = root.optString("mode", prefs.getString("alert_mode", "notify"));
            String prev = prefs.getString(KEY_SCHEDULED, "");
            java.util.LinkedHashSet<String> tracked = new java.util.LinkedHashSet<>();
            for (String key : prev.split(",")) if (!key.isEmpty()) tracked.add(key);
            for (int i = 0; i < alarms.length(); i++) tracked.add(alarms.getJSONObject(i).getString("key"));
            JSONObject snoozes = new JSONObject(prefs.getString("snoozes", "{}"));
            java.util.Iterator<String> snoozeKeys = snoozes.keys();
            while (snoozeKeys.hasNext()) tracked.add(snoozeKeys.next());
            StringBuilder trackedKeys = new StringBuilder();
            for (String key : tracked) {
                if (trackedKeys.length() > 0) trackedKeys.append(',');
                trackedKeys.append(key);
            }
            // Commit before touching OS timers so a process death is recoverable.
            if (!prefs.edit().putString(KEY_PAYLOAD, json)
                    .putString(KEY_SCHEDULED, trackedKeys.toString())
                    .putString("sound", root.optString("sound", "chime"))
                    .putString("alert_mode", mode).commit())
                return "{\"ok\":false,\"error\":\"cannot persist alarms\"}";
            if (prev != null) {
                for (String key : prev.split(",")) {
                    if (key.isEmpty()) continue;
                    am.cancel(pending(ctx, key));
                    // Migrate PendingIntents created by the old hash-only identity.
                    Intent legacy = new Intent(ctx, AlarmReceiver.class).setAction("app.lifeos.twa.ALARM");
                    PendingIntent old = PendingIntent.getBroadcast(ctx, key.hashCode(), legacy,
                            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                    if (old != null) { am.cancel(old); old.cancel(); }
                }
            }
            StringBuilder scheduledKeys = new StringBuilder();
            int scheduled = 0;
            long nextAt = 0;
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                String key = a.optString("key", "");
                long at = alarmTime(a);
                if ("off".equals(mode) || key.isEmpty() || at <= System.currentTimeMillis()) continue;
                // The user turned this alarm off on the device — it stays off
                // for this occurrence even if the web pushes the same key again.
                if (isDismissed(prefs, key)) continue;

                prefs.edit()
                        .putString("alarm:" + key + ":title", a.optString("title", "LifeOS alarm"))
                        .putString("alarm:" + key + ":body", a.optString("body", ""))
                        .putString("sound", root.optString("sound", "chime"))
                        .apply();

                exact = scheduleExact(ctx, am, key, at) && exact;
                if (scheduledKeys.length() > 0) scheduledKeys.append(',');
                scheduledKeys.append(key);
                scheduled++;
                if (nextAt == 0 || at < nextAt) nextAt = at;
            }
            // Preserve snoozes through web updates, reboot and permission grants.
            JSONArray active = root.optJSONArray("activeKeys");
            java.util.HashSet<String> activeKeys = new java.util.HashSet<>();
            if (active != null) for (int i = 0; i < active.length(); i++) activeKeys.add(active.getString(i));
            java.util.Iterator<String> it = snoozes.keys();
            while (it.hasNext()) {
                String key = it.next();
                long at = snoozes.optLong(key);
                if ("off".equals(mode) || (active != null && !activeKeys.contains(key)) || isDismissed(prefs, key) || at <= System.currentTimeMillis()) {
                    am.cancel(pending(ctx, key));
                    it.remove();
                    continue;
                }
                exact = scheduleExact(ctx, am, key, at) && exact;
                if (scheduledKeys.length() > 0) scheduledKeys.append(',');
                scheduledKeys.append(key);
                scheduled++;
                if (nextAt == 0 || at < nextAt) nextAt = at;
            }
            prefs.edit().putString(KEY_SCHEDULED, scheduledKeys.toString())
                    .putString("snoozes", snoozes.toString()).commit();
            if ("off".equals(mode)) AlarmSoundService.stop(ctx);
            return "{\"ok\":true,\"exact\":" + exact + ",\"scheduled\":" + scheduled + ",\"next\":" + nextAt + "}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(e).replace("\\", " ").replace("\"", "'") + "\"}";
        }
    }

    /** One-off alarm used by the notification's Snooze action. */
    public static synchronized boolean snooze(Context ctx, String key, int minutes) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return false;
            long at = System.currentTimeMillis() + minutes * 60_000L;
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject snoozes = new JSONObject(prefs.getString("snoozes", "{}"));
            snoozes.put(key, at);
            if (!prefs.edit().putString("snoozes", snoozes.toString()).commit()) return false;
            scheduleExact(ctx, am, key, at);
            return true;
        } catch (Exception ignored) { return false; }
    }

    /** Permission may be revoked between the check and setAlarmClock(). */
    private static boolean scheduleExact(Context ctx, AlarmManager am, String key, long at) {
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
            try {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openApp(ctx)), pending(ctx, key));
                return true;
            } catch (SecurityException denied) { /* fall back, report exact:false */ }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, key));
        return false;
    }

    private static long alarmTime(JSONObject a) throws Exception {
        String local = a.optString("localAt", "");
        if (local.isEmpty()) return a.getLong("at");
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US);
        // Calendar's gap normalization agrees with JS local Date construction.
        long at = format.parse(local).getTime();
        // JS Date chooses the first instant in an autumn DST overlap.
        java.util.TimeZone zone = format.getTimeZone();
        int overlap = zone.getOffset(at - 86_400_000L) - zone.getOffset(at);
        if (overlap > 0 && format.format(new java.util.Date(at - overlap)).equals(local.substring(0, 16))) at -= overlap;
        return at - a.optLong("leadMinutes", 0) * 60_000L;
    }

    /** Ignore cancelled, stale or already dismissed PendingIntents. */
    public static synchronized boolean shouldDeliver(Context ctx, String key) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (isDismissed(prefs, key) || "off".equals(prefs.getString("alert_mode", "notify"))) return false;
        try {
            JSONObject snoozes = new JSONObject(prefs.getString("snoozes", "{}"));
            if (snoozes.has(key)) {
                if (snoozes.getLong(key) > System.currentTimeMillis() + 1000) return false;
                snoozes.remove(key);
                prefs.edit().putString("snoozes", snoozes.toString()).commit();
                return true;
            }
            JSONArray alarms = new JSONObject(prefs.getString(KEY_PAYLOAD, "{}")).getJSONArray("alarms");
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                if (key.equals(a.optString("key"))) return alarmTime(a) <= System.currentTimeMillis() + 1000;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private static PendingIntent openApp(Context ctx) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        return PendingIntent.getActivity(ctx, 900001, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Re-schedule everything from the persisted snapshot (called after boot). */
    public static synchronized void rescheduleAll(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_PAYLOAD, null);
        if (json != null) scheduleFromJson(ctx, json);
    }

    // ---- Turned-off tracking: a stopped alarm never rings again for this
    // ---- occurrence, even when the web re-pushes the same key every minute.

    /** Called by AlarmReceiver's "Turn off" action. */
    public static synchronized void markDismissed(Context ctx, String key) {
        if (key == null || key.isEmpty()) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(ctx, key));
        String cur = prefs.getString(KEY_DISMISSED, "");
        for (String k : cur.split(",")) if (k.equals(key)) return; // already there
        String next = cur.isEmpty() ? key : cur + "," + key;
        // Cap the list — keys embed their occurrence time, old ones never match.
        String[] parts = next.split(",");
        if (parts.length > 100) {
            StringBuilder sb = new StringBuilder();
            for (int i = parts.length - 100; i < parts.length; i++) {
                if (sb.length() > 0) sb.append(',');
                sb.append(parts[i]);
            }
            next = sb.toString();
        }
        prefs.edit().putString(KEY_DISMISSED, next).commit();
    }

    private static boolean isDismissed(SharedPreferences prefs, String key) {
        for (String k : prefs.getString(KEY_DISMISSED, "").split(",")) {
            if (k.equals(key)) return true;
        }
        return false;
    }

    /** Keys turned off on this device — the web side adopts these so the
     * dismissal propagates to every other device via the shared record. */
    public static String dismissedKeys(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_DISMISSED, "");
    }

    private static PendingIntent pending(Context ctx, String key) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("app.lifeos.twa.ALARM");
        i.setData(Uri.parse("lifeos://alarm/" + Uri.encode(key)));
        i.putExtra("key", key);
        return PendingIntent.getBroadcast(ctx, key.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
