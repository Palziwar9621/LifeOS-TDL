package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

/**
 * Fired by AlarmManager at the alarm time. Shows a max-importance
 * notification and plays a looping alarm sound + vibration that keeps going
 * until the user taps Dismiss or opens the app — even though the app itself
 * is closed. (A foreground service would be even more robust, but this runs
 * entirely in the broadcast receiver's allow-listed window, no extra
 * permission dialogs needed.)
 */
public class AlarmReceiver extends BroadcastReceiver {

    static final String CHANNEL_ID = "lifeos_alarms";
    static final String ACTION_DISMISS = "app.lifeos.twa.DISMISS";
    static final String EXTRA_NOTIF_ID = "notif_id";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ACTION_DISMISS.equals(action)) {
            AlarmSoundService.stop(ctx);
            int id = intent.getIntExtra(EXTRA_NOTIF_ID, 0);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
            return;
        }

        String key = intent.getStringExtra("key");
        if (key == null) return;
        android.content.SharedPreferences prefs = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        String title = prefs.getString("alarm:" + key + ":title", "⏰ LifeOS alarm");
        String body = prefs.getString("alarm:" + key + ":body", "");
        String sound = prefs.getString("sound", "chime");

        int notifId = key.hashCode();

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // Max-importance channel: heads-up on lock screen, sound, vibration.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "LifeOS alarms",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Reminders, tasks and routines");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[]{0, 500, 150, 500, 150, 500, 150, 800});
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(false);
            nm.createNotificationChannel(ch);
        }

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        open.putExtra("lifeos-alarm-key", key);
        PendingIntent pOpen = PendingIntent.getActivity(ctx, notifId, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent dismiss = new Intent(ctx, AlarmReceiver.class);
        dismiss.setAction(ACTION_DISMISS);
        dismiss.putExtra(EXTRA_NOTIF_ID, notifId);
        PendingIntent pDismiss = PendingIntent.getBroadcast(ctx, notifId + 1, dismiss,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, CHANNEL_ID)
                : new Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setFullScreenIntent(pOpen, true)
                .setContentIntent(pOpen)
                .addAction(new Notification.Action.Builder(
                        null, "Dismiss",
                        pDismiss).build());

        nm.notify(notifId, b.build());

        // Looping sound + vibration until dismissed. Runs in a service so it
        // survives past the receiver's ~10s window.
        AlarmSoundService.start(ctx, notifId, sound);
    }
}
