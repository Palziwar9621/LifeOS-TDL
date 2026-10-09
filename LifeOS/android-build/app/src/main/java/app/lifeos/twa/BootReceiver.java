package app.lifeos.twa;

import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores alarm snapshots; microphone capture requires a foreground user flow. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || Intent.ACTION_TIME_CHANGED.equals(a)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(a)
                || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(a)
                || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
            AlarmScheduler.rescheduleAll(ctx);
            // Android 14+ while-in-use microphone restrictions (and Android 15
            // boot restrictions) prohibit starting the assistant here.
        }
    }
}
