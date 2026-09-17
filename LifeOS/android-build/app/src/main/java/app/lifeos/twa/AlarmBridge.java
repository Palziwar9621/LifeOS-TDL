package app.lifeos.twa;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

/**
 * Exposed to the web app as window.LifeOSNative.alarms. The web side
 * (nativeAlarms.ts) posts its computed upcoming alarms here; they are
 * scheduled with AlarmManager and ring even when the app is closed.
 */
public class AlarmBridge {
    private final Context ctx;

    public AlarmBridge(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    @JavascriptInterface
    public String scheduleAlarms(String json) {
        return AlarmScheduler.scheduleFromJson(ctx, json);
    }

    /** Debug/diagnostic: has a next-run been persisted (i.e. a schedule arrived)? */
    @JavascriptInterface
    public String status() {
        SharedPreferences prefs = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        String payload = prefs.getString("payload", null);
        String keys = prefs.getString("scheduled_keys", "");
        int count = keys.isEmpty() ? 0 : keys.split(",").length;
        return "{\"hasPayload\":" + (payload != null) + ",\"scheduled\":" + count + "}";
    }

    /** Keys the user turned off on this device — web side adopts them into
     * the shared record so the dismissal silences every other device too. */
    @JavascriptInterface
    public String dismissedKeys() {
        return AlarmScheduler.dismissedKeys(ctx);
    }

    /** Can this app schedule exact alarms right now? */
    @JavascriptInterface
    public boolean canScheduleExact() {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT >= 31) return am.canScheduleExactAlarms();
        return true; // pre-Android-12: always allowed
    }

    /** Open the system "Alarms & reminders" screen for this app (grant screen). */
    @JavascriptInterface
    public void openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception ignored) { /* some devices lack the screen */ }
        }
    }
}
