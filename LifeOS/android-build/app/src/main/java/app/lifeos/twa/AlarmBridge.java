package app.lifeos.twa;

import android.content.Context;
import android.content.SharedPreferences;
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
}
