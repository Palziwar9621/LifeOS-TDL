package app.lifeos.twa;

import android.content.Context;
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
    public void scheduleAlarms(String json) {
        AlarmScheduler.scheduleFromJson(ctx, json);
    }
}
