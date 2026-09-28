package app.lifeos.twa;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

/**
 * Exposed to the web app as window.LifeOSAssistant.
 * Starts/stops the background wake-word service and configures it.
 * The service needs two permissions granted by the user: microphone
 * (runtime) and "Display over other apps" (for the full-screen wake
 * notification on some OEMs — we open the settings page when missing).
 */
public class AssistantBridge {
    private final Activity activity;

    public AssistantBridge(Activity activity) { this.activity = activity; }

    @JavascriptInterface
    public String setWakeEnabled(boolean enabled, String wakeWord) {
        SharedPreferences p = activity.getSharedPreferences(AssistantService.PREFS, Activity.MODE_PRIVATE);
        p.edit().putBoolean(AssistantService.KEY_ENABLED, enabled)
                .putString(AssistantService.KEY_WAKE_WORD, wakeWord == null || wakeWord.isEmpty() ? "hey lifeos" : wakeWord)
                .apply();
        Intent svc = new Intent(activity, AssistantService.class);
        try {
            if (enabled) {
                if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(svc);
                else activity.startService(svc);
            } else {
                svc.setAction("stop");
                activity.startService(svc);
            }
            return "{\"ok\":true}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(e).replace("\"", "'") + "\"}";
        }
    }

    /** True when the background listener is currently configured on. */
    @JavascriptInterface
    public boolean wakeEnabled() {
        return activity.getSharedPreferences(AssistantService.PREFS, Activity.MODE_PRIVATE)
                .getBoolean(AssistantService.KEY_ENABLED, false);
    }

    @JavascriptInterface
    public String wakeWord() {
        return activity.getSharedPreferences(AssistantService.PREFS, Activity.MODE_PRIVATE)
                .getString(AssistantService.KEY_WAKE_WORD, "hey lifeos");
    }

    /** Open the system mic permission page for LifeOS. */
    @JavascriptInterface
    public void requestMicPermission() {
        if (Build.VERSION.SDK_INT >= 23) {
            activity.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 2002);
        }
    }

    /** Open the "display over other apps" settings (needed on some OEMs for the wake popup). */
    @JavascriptInterface
    public void openOverlaySettings() {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
        } catch (Exception ignored) {}
    }
}
