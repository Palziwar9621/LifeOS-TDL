package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Posts a plain system notification (no alarm sound) for routine/task times.
 * Used when the user's alert mode is "notification only". Sound service is
 * NOT started — silent, visible, tappable.
 */
public final class NotifHelper {

    private static final String CHANNEL_ID = "lifeos_alerts";

    private NotifHelper() {}

    /** Show a silent notification; returns the notification id used. */
    public static int show(Context ctx, String key, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return 0;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Routine & task alerts",
                    NotificationManager.IMPORTANCE_DEFAULT); // soundless but visible + heads-up-ish
            ch.setDescription("It's time for a routine or task");
            nm.createNotificationChannel(ch);
        }

        int notifId = key.hashCode();
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent(ctx, MainActivity.class);
        PendingIntent pOpen = PendingIntent.getActivity(ctx, notifId, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, CHANNEL_ID)
                : new Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true) // tap = read
                .setContentIntent(pOpen);

        nm.notify(notifId, b.build());
        return notifId;
    }

    /** Which alert mode did the web app last send? Mirrors the Settings toggle. */
    public static String alertMode(Context ctx) {
        return ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE)
                .getString("alert_mode", "notify");
    }

    public static void setAlertMode(Context ctx, String mode) {
        ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE)
                .edit().putString("alert_mode", mode).apply();
    }

    /** Suppress ring for a key the user already handled (kept tiny on purpose). */
    public static boolean isSuppressed(Context ctx, String key) {
        SharedPreferences p = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        for (String k : p.getString("notif_shown", "").split(",")) {
            if (k.equals(key)) return true;
        }
        return false;
    }

    public static void markShown(Context ctx, String key) {
        SharedPreferences p = ctx.getSharedPreferences("lifeos_alarms", Context.MODE_PRIVATE);
        String cur = p.getString("notif_shown", "");
        if (cur.contains(key)) return;
        String next = cur.isEmpty() ? key : cur + "," + key;
        String[] parts = next.split(",");
        if (parts.length > 200) {
            StringBuilder sb = new StringBuilder();
            for (int i = parts.length - 200; i < parts.length; i++) {
                if (sb.length() > 0) sb.append(',');
                sb.append(parts[i]);
            }
            next = sb.toString();
        }
        p.edit().putString("notif_shown", next).apply();
    }
}
