package app.lifeos.twa;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives the web app's upcoming-alarm list through the JS bridge and
 * schedules each one with AlarmManager.setAlarmClock() — that API is
 * guaranteed to fire at the exact minute (even in Doze) and needs no
 * special permission on Android 12+. The list is persisted so BootReceiver
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
    public static String scheduleFromJson(Context ctx, String json) {
        try {
            JSONObject root = new JSONObject(json);
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return "{\"ok\":false,\"error\":\"no AlarmManager\"}";

            // Cancel every previously scheduled alarm (stable request code per key).
            String prev = prefs.getString(KEY_SCHEDULED, null);
            if (prev != null) {
                for (String key : prev.split(",")) {
                    if (key.isEmpty()) continue;
                    am.cancel(pending(ctx, key));
                }
            }
            prefs.edit().remove(KEY_SCHEDULED).apply();

            // Persist for boot reschedule + receiver lookups.
            prefs.edit().putString(KEY_PAYLOAD, json).apply();

            StringBuilder scheduledKeys = new StringBuilder();
            JSONArray alarms = root.optJSONArray("alarms");
            if (alarms == null) return "{\"ok\":false,\"error\":\"no alarms array\"}";
            int scheduled = 0;
            long nextAt = 0;
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                String key = a.optString("key", "");
                long at = a.optLong("at", 0);
                if (key.isEmpty() || at <= System.currentTimeMillis()) continue;
                // The user turned this alarm off on the device — it stays off
                // for this occurrence even if the web pushes the same key again.
                if (isDismissed(prefs, key)) continue;

                prefs.edit()
                        .putString("alarm:" + key + ":title", a.optString("title", "LifeOS alarm"))
                        .putString("alarm:" + key + ":body", a.optString("body", ""))
                        .putString("sound", root.optString("sound", "chime"))
                        .apply();

                scheduleExact(ctx, am, key, at);
                if (scheduledKeys.length() > 0) scheduledKeys.append(',');
                scheduledKeys.append(key);
                scheduled++;
                if (nextAt == 0 || at < nextAt) nextAt = at;
            }
            prefs.edit().putString(KEY_SCHEDULED, scheduledKeys.toString()).apply();
            return "{\"ok\":true,\"scheduled\":" + scheduled + ",\"next\":" + nextAt + "}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(e).replace("\\", " ").replace("\"", "'") + "\"}";
        }
    }

    /** One-off alarm used by the notification's Snooze action. */
    public static void snooze(Context ctx, String key, int minutes) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = System.currentTimeMillis() + minutes * 60_000L;
            scheduleExact(ctx, am, key, at);
        } catch (Exception ignored) {}
    }

    /** setAlarmClock(): always exact, fires in Doze, no SCHEDULE_EXACT_ALARM needed. */
    private static void scheduleExact(Context ctx, AlarmManager am, String key, long at) {
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openApp(ctx)), pending(ctx, key));
    }

    private static PendingIntent openApp(Context ctx) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        return PendingIntent.getActivity(ctx, 900001, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Re-schedule everything from the persisted snapshot (called after boot). */
    public static void rescheduleAll(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_PAYLOAD, null);
        if (json != null) scheduleFromJson(ctx, json);
    }

    // ---- Turned-off tracking: a stopped alarm never rings again for this
    // ---- occurrence, even when the web re-pushes the same key every minute.

    /** Called by AlarmReceiver's "Turn off" action. */
    public static void markDismissed(Context ctx, String key) {
        if (key == null || key.isEmpty()) return;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
        prefs.edit().putString(KEY_DISMISSED, next).apply();
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
        i.putExtra("key", key);
        return PendingIntent.getBroadcast(ctx, key.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
