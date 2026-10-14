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
 * The alarm rings UNTIL the user taps Snooze, taps Turn off, or swipes the
 * notification away —
 * no time cap. A dismissed alarm never re-fires: it only rings again when
 * its next interval is scheduled (Snooze schedules one explicitly).
 */
public class AlarmReceiver extends BroadcastReceiver {

    // A new soundless channel: our service, not the channel's default beep,
    // plays the selected melody. Channel sound cannot be changed after creation.
    static final String CHANNEL_ID = "lifeos_alarms_v2";
    static final String ACTION_DISMISS = "app.lifeos.twa.DISMISS";
    static final String ACTION_SNOOZE = "app.lifeos.twa.SNOOZE";
    static final String EXTRA_NOTIF_ID = "notif_id";
    static final String EXTRA_KEY = "key";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ACTION_DISMISS.equals(action)) {
            String key = intent.getStringExtra(EXTRA_KEY);
            int notifId = notificationId(key, intent.getIntExtra(EXTRA_NOTIF_ID, 0));
            AlarmSoundService.stop(ctx, key, notifId);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && key != null) nm.cancel(key, notifId);
            // Turned off = dead for this occurrence, even when the web app
            // re-pushes the same alarm key on its next sync.
            AlarmScheduler.markDismissed(ctx, key);
            AlarmBridge.notifyWeb(key, false);
            return;
        }
        if (ACTION_SNOOZE.equals(action)) {
            String key = intent.getStringExtra(EXTRA_KEY);
            if (key == null || !AlarmScheduler.snooze(ctx, key, 10)) return;
            AlarmSoundService.stop(ctx, key, notificationId(key, intent.getIntExtra(EXTRA_NOTIF_ID, 0)));
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(key, notificationId(key, intent.getIntExtra(EXTRA_NOTIF_ID, 0)));
            AlarmBridge.notifyWeb(key, true);
            return;
        }


        String key = intent.getStringExtra(EXTRA_KEY);
        if (key == null || !AlarmScheduler.shouldDeliver(ctx, key)) return;
        SharedPreferences prefs = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        String title = prefs.getString("alarm:" + key + ":title", "⏰ LifeOS alarm");
        String body = prefs.getString("alarm:" + key + ":body", "");

        // Alert mode from the web app's Settings: "notify" = silent notification
        // only (no alarm sound). "alarm" = full alarm. Default: notify.
        if ("notify".equals(NotifHelper.alertMode(ctx)) || "none".equals(prefs.getString("sound", "chime"))) {
            if (NotifHelper.isSuppressed(ctx, key)) return; // already notified this occurrence
            NotifHelper.markShown(ctx, key);
            NotifHelper.show(ctx, key, title, body);
            return;
        }

        final int notifId = notificationId(key, 0);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (android.os.Build.VERSION.SDK_INT >= 24 && !nm.areNotificationsEnabled()) return;

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "LifeOS alarms",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Reminders, tasks and routines");
            ch.setSound(null, null);
            ch.enableVibration(false);
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
                 // A swipe is the same user intent as Turn off. Keep the
                 // notification dismissible, but route its delete callback
                 // through the key-scoped stop/dismiss path below.
                 .setOngoing(false)
                 .setDeleteIntent(pDismiss)
                 .setContentIntent(pOpen)
                .addAction(new Notification.Action.Builder(null, "Snooze 10m", pSnooze).build())
                .addAction(new Notification.Action.Builder(null, "Turn off", pDismiss).build());

        // Auto-open consistency: the full-screen intent fires ONLY when the
        // system grants it (Android 14+ lets users revoke "Alarms & reminders";
        // some OEM skins block it by default). When it can't fire we do NOT set
        // it at all — behavior is then deterministic per device: always
        // auto-open (permission granted) or never (tap the notification to
        // open) — instead of silently working only some of the time.
        if (android.os.Build.VERSION.SDK_INT < 34) b.setFullScreenIntent(pOpen, true);
        else if (nm.canUseFullScreenIntent()) b.setFullScreenIntent(pOpen, true);
        Notification notification = b.build();
        nm.notify(key, notifId, notification);

        // Looping sound + vibration until the user acts (no cap).
        AlarmSoundService.start(ctx, key, notifId, prefs.getString("sound", "chime"), notification);
    }

    private static int notificationId(String key, int fallback) {
        int id = key == null ? fallback : key.hashCode();
        return id == 0 ? (fallback == 0 ? 1 : fallback) : id;
    }

    private static PendingIntent action(Context ctx, String action, String key, int requestCode, int notifId) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(action);
        i.setData(android.net.Uri.parse("lifeos://alarm-action/" + android.net.Uri.encode(key)));
        i.putExtra(EXTRA_KEY, key);
        i.putExtra(EXTRA_NOTIF_ID, notifId);
        return PendingIntent.getBroadcast(ctx, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
