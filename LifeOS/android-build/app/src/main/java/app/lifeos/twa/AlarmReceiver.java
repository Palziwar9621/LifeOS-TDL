package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Fired by AlarmManager at the alarm time. Shows a max-importance,
 * full-screen notification and starts the looping sound/vibration service.
 * The alarm rings UNTIL the user taps Snooze, Dismiss, or opens the app —
 * no time cap. A dismissed alarm never re-fires: it only rings again when
 * its next interval is scheduled (Snooze schedules one explicitly).
 */
public class AlarmReceiver extends BroadcastReceiver {

    static final String CHANNEL_ID = "lifeos_alarms";
    static final String ACTION_DISMISS = "app.lifeos.twa.DISMISS";
    static final String ACTION_SNOOZE = "app.lifeos.twa.SNOOZE";
    static final String EXTRA_NOTIF_ID = "notif_id";
    static final String EXTRA_KEY = "key";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ACTION_DISMISS.equals(action)) {
            AlarmSoundService.stop(ctx);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(intent.getIntExtra(EXTRA_NOTIF_ID, 0));
            return;
        }
        if (ACTION_SNOOZE.equals(action)) {
            AlarmSoundService.stop(ctx);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(intent.getIntExtra(EXTRA_NOTIF_ID, 0));
            String key = intent.getStringExtra(EXTRA_KEY);
            if (key != null) AlarmScheduler.snooze(ctx, key, 10);
            return;
        }

        String key = intent.getStringExtra(EXTRA_KEY);
        if (key == null) return;
        SharedPreferences prefs = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        String title = prefs.getString("alarm:" + key + ":title", "⏰ LifeOS alarm");
        String body = prefs.getString("alarm:" + key + ":body", "");

        final int notifId = key.hashCode();

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "LifeOS alarms",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Reminders, tasks and routines");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 500, 150, 500, 150, 500, 150, 800});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        open.putExtra("lifeos-alarm-key", key);
        PendingIntent pOpen = PendingIntent.getActivity(ctx, notifId, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent pDismiss = action(ctx, ACTION_DISMISS, key, notifId + 1, notifId);
        PendingIntent pSnooze = action(ctx, ACTION_SNOOZE, key, notifId + 2, notifId);

        Notification.Builder b = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, CHANNEL_ID)
                : new Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true) // can't be swiped away — must be acted on
                .setFullScreenIntent(pOpen, true)
                .setContentIntent(pOpen)
                .addAction(new Notification.Action.Builder(null, "Snooze 10m", pSnooze).build())
                .addAction(new Notification.Action.Builder(null, "Turn off", pDismiss).build());

        nm.notify(notifId, b.build());

        // Looping sound + vibration until the user acts (no cap).
        AlarmSoundService.start(ctx, notifId, prefs.getString("sound", "chime"));
    }

    private static PendingIntent action(Context ctx, String action, String key, int requestCode, int notifId) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(action);
        i.putExtra(EXTRA_KEY, key);
        i.putExtra(EXTRA_NOTIF_ID, notifId);
        return PendingIntent.getBroadcast(ctx, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
