package app.lifeos.twa;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** Re-schedules persisted alarms after reboot, and restarts the wake-word
 *  service if the user had it enabled. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
            AlarmScheduler.rescheduleAll(ctx);

            // Wake-word service: restart if the user left it on.
            SharedPreferences p = ctx.getSharedPreferences(AssistantService.PREFS, Context.MODE_PRIVATE);
            if (p.getBoolean(AssistantService.KEY_ENABLED, false)) {
                Intent svc = new Intent(ctx, AssistantService.class);
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc);
                else ctx.startService(svc);
            }
        }
    }
}
