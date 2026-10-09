package app.lifeos.twa;

import android.app.Notification;
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
    private AudioTrack player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    public static void start(Context ctx, int notifId, String soundId, Notification notification) {
        Intent intent = new Intent(ctx, AlarmSoundService.class)
                .putExtra("notif_id", notifId == 0 ? 1 : notifId)
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
        Notification notification = intent.getParcelableExtra("notification");
        if (notification == null) { stopSelf(); return START_NOT_STICKY; }
        startForeground(intent.getIntExtra("notif_id", 1), notification);
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
        super.onDestroy();
    }
}
