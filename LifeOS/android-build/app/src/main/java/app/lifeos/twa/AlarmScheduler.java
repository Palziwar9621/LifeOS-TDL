package app.lifeos.twa;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives the web app's upcoming-alarm list through the JS bridge and
 * schedules each one with AlarmManager (exact alarms, so they ring at the
 * right minute even when the app process is dead). The full list is also
 * persisted so BootReceiver can re-schedule everything after a reboot.
 */
public class AlarmScheduler {

    private static final String PREFS = "lifeos_alarms";
    private static final String KEY_PAYLOAD = "payload";
    private static final String KEY_SCHEDULED = "scheduled_keys";

    /** Entry point from the JS bridge: payload = {sound, alarms:[{key,at,title,body}]}. */
    public static void scheduleFromJson(Context ctx, String json) {
        try {
            JSONObject root = new JSONObject(json);
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

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
            if (alarms == null) return;
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                String key = a.optString("key", "");
                long at = a.optLong("at", 0);
                if (key.isEmpty() || at <= System.currentTimeMillis()) continue;

                prefs.edit()
                        .putString("alarm:" + key + ":title", a.optString("title", "LifeOS alarm"))
                        .putString("alarm:" + key + ":body", a.optString("body", ""))
                        .putString("sound", root.optString("sound", "chime"))
                        .apply();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                    // Permission not granted (rare; we request it in MainActivity) —
                    // inexact is better than nothing.
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, key));
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, key));
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, at, pending(ctx, key));
                }
                if (scheduledKeys.length() > 0) scheduledKeys.append(',');
                scheduledKeys.append(key);
            }
            prefs.edit().putString(KEY_SCHEDULED, scheduledKeys.toString()).apply();
        } catch (Exception ignored) {
            // Never crash the shell from bad JS input.
        }
    }

    /** Re-schedule everything from the persisted snapshot (called after boot). */
    public static void rescheduleAll(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_PAYLOAD, null);
        if (json != null) scheduleFromJson(ctx, json);
    }

    private static PendingIntent pending(Context ctx, String key) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("app.lifeos.twa.ALARM");
        i.putExtra("key", key);
        return PendingIntent.getBroadcast(ctx, key.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
