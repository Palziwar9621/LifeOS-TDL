package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

/** A real media-playback foreground service, independent of the WebView process
 * lifecycle. Static playback from a receiver used to die as soon as it returned. */
public class AlarmSoundService extends Service {
    static final String ACTION_STOP = "app.lifeos.twa.STOP_ALARM";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_NOTIF_ID = "notif_id";
    private static final String PLAYBACK_CHANNEL = "lifeos_alarm_playback";
    private static final int PLAYBACK_NOTIFICATION = 900002;
    private AudioTrack player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private String activeKey;
    private int activeNotifId;

    public static void start(Context ctx, String key, int notifId, String soundId, Notification notification) {
        Intent intent = new Intent(ctx, AlarmSoundService.class)
                .putExtra(EXTRA_KEY, key)
                .putExtra(EXTRA_NOTIF_ID, notifId == 0 ? 1 : notifId)
                .putExtra("sound", soundId).putExtra("notification", notification);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent);
            else ctx.startService(intent);
        } catch (RuntimeException unavailable) {
            // Inexact alarms do not carry Android 12+'s exact-alarm exemption
            // for starting an FGS. Keep the visible notification in that case.
            ctx.getSharedPreferences("lifeos_alarms", MODE_PRIVATE).edit()
                    .putString("playback_error", unavailable.getClass().getSimpleName()).apply();
        }
    }

    public static void stop(Context ctx) { ctx.stopService(new Intent(ctx, AlarmSoundService.class)); }

    /** Stop only the alarm instance represented by a notification action. */
    public static void stop(Context ctx, String key, int notifId) {
        Intent intent = new Intent(ctx, AlarmSoundService.class)
                .setAction(ACTION_STOP)
                .putExtra(EXTRA_KEY, key)
                .putExtra(EXTRA_NOTIF_ID, notifId == 0 ? 1 : notifId);
        try {
            // The service is already foreground while an alarm is ringing;
            // dispatching a command keeps the identity check in the service's
            // serialized command queue instead of stopping a newer alarm.
            ctx.startService(intent);
        } catch (RuntimeException ignored) {
            // If playback already ended, there is nothing left to stop.
        }
    }

    private void releasePlayback() {
        if (player != null) {
            try { player.stop(); } catch (RuntimeException ignored) { }
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if (ACTION_STOP.equals(intent.getAction())) {
            String key = intent.getStringExtra(EXTRA_KEY);
            int notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 0);
            if (sameAlarm(key, notifId)) {
                releasePlayback();
                if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
                else stopForeground(true);
                activeKey = null;
                activeNotifId = 0;
                stopSelfResult(startId);
            } else {
                // A stale action must not stop a newer active alarm. If
                // playback already ended, also avoid leaving an idle service
                // behind after a late stop command started this service.
                if (activeKey == null) stopSelfResult(startId);
            }
            return START_NOT_STICKY;
        }
        Notification notification = intent.getParcelableExtra("notification");
        if (notification == null) { stopSelf(); return START_NOT_STICKY; }
        activeKey = intent.getStringExtra(EXTRA_KEY);
        activeNotifId = intent.getIntExtra(EXTRA_NOTIF_ID, 1);
        // Pre-Android 14 foreground-service notifications cannot be swiped,
        // even with setOngoing(false). Keep a separate low-priority service
        // indicator; the tagged alarm notification remains swipeable on every
        // supported OS version. Both expose the same key-scoped actions.
        startForeground(PLAYBACK_NOTIFICATION, playbackNotification(notification));
        releasePlayback();
        String sound = intent.getStringExtra("sound");
        if ("none".equals(sound)) { stopSelf(); return START_NOT_STICKY; }
        try {
            short[] samples = AlarmTone.samples(sound);
            AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            player = new AudioTrack.Builder().setAudioAttributes(attributes)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(AlarmTone.SAMPLE_RATE)
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.length * 2).build();
            player.write(samples, 0, samples.length);
            player.setLoopPoints(0, samples.length, -1);
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LifeOS:alarm-playback");
                wakeLock.acquire(); // released on every stop / replacement / destroy
            }
            player.play();
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 500, 150, 500, 150, 800};
                if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                else vibrator.vibrate(pattern, 0);
            }
        } catch (RuntimeException failed) {
            getSharedPreferences("lifeos_alarms", MODE_PRIVATE).edit()
                    .putString("playback_error", failed.getClass().getSimpleName()).apply();
            releasePlayback();
            stopForeground(false); // keep notification and its actions available
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        releasePlayback();
        activeKey = null;
        activeNotifId = 0;
        super.onDestroy();
    }

    private boolean sameAlarm(String key, int notifId) {
        return activeKey != null && activeKey.equals(key)
                && activeNotifId == (notifId == 0 ? 1 : notifId);
    }

    private Notification playbackNotification(Notification alarm) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(PLAYBACK_CHANNEL,
                    "Alarm playback", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            channel.enableVibration(false);
            if (nm != null) nm.createNotificationChannel(channel);
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, PLAYBACK_CHANNEL) : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("LifeOS alarm is ringing")
                .setContentText("Swipe the alarm notification or use Turn off")
                .setContentIntent(alarm.contentIntent)
                .setDeleteIntent(alarm.deleteIntent)
                .setOnlyAlertOnce(true).setOngoing(false);
        if (alarm.actions != null) for (Notification.Action action : alarm.actions) builder.addAction(action);
        return builder.build();
    }
}
