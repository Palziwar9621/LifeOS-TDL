package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import java.util.Locale;

/** Explicitly enabled background wake using the same local PCM/Vosk engine as the page. */
public class AssistantService extends Service {
    private static final String CHANNEL = "lifeos_assistant";
    private static final int NOTIF_ID = 2001;
    public static final String PREFS = "lifeos_assistant";
    public static final String KEY_ENABLED = "wake_enabled";
    public static final String KEY_WAKE_WORD = "wake_word";

    private final Handler handler = new Handler(android.os.Looper.getMainLooper());
    private EmbeddedSpeechEngine.Session recognizer;
    private String wakeWord = "hey lifeos";
    private int generation;
    private boolean started;
    private boolean destroyed;
    private boolean sessionEnded;
    private final Runnable resume = this::startListening;
    private static AssistantService instance;
    private static boolean appForeground = false;

    /** Called on the activity's main looper, before foreground microphone use. */
    public static void setAppForeground(boolean foreground) {
        appForeground = foreground;
        AssistantService service = instance;
        if (service == null) return;
        service.pauseListening();
        if (foreground) service.updateNotification("Wake listener paused while LifeOS is open");
        else if (!service.sessionEnded) service.handler.postDelayed(service.resume, 750);
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Voice assistant", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Optional on-device wake session");
            channel.setSound(null, null);
            channel.enableVibration(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        // Listening starts only after onStartCommand checks explicit opt-in and
        // permission. Merely creating or stopping this service cannot take the mic.
    }

    private Notification notification(String detail) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        builder.setContentTitle("LifeOS voice assistant")
                .setContentText(detail)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOnlyAlertOnce(true)
                .setOngoing(!sessionEnded);
        if (open != null) builder.setContentIntent(PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return builder.build();
    }

    private void updateNotification(String detail) {
        if (started && !destroyed) getSystemService(NotificationManager.class).notify(NOTIF_ID, notification(detail));
    }

    private boolean enabled() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false);
    }

    private void startListening() {
        handler.removeCallbacks(resume);
        if (destroyed || !started || sessionEnded || appForeground || recognizer != null) return;
        if (!enabled() || checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }
        final int token = ++generation;
        updateNotification("Preparing offline wake model…");
        recognizer = EmbeddedSpeechEngine.start(this, new EmbeddedSpeechEngine.Listener() {
            private boolean current() { return !destroyed && token == generation && !appForeground && enabled(); }
            @Override public void onReady(boolean aec) {
                if (current()) updateNotification("Offline wake: say \"" + wakeWord + "\"");
            }
            @Override public void onText(String text, boolean isFinal) {
                // Silence leaves one PCM session open, without recognizer restart
                // tones or requests to a network recognition service.
                if (current() && !text.isEmpty()) checkWake(text);
            }
            @Override public void onError(String error) {
                if (current()) finishSession("Wake stopped (" + error + "); open LifeOS to re-enable");
            }
        });
    }

    private boolean checkWake(String text) {
        if ((" " + SpeechText.normalize(SpeechText.wakeSpelling(text)) + " ")
                .contains(" " + SpeechText.normalize(wakeWord) + " ")) {
            pauseListening();
            sessionEnded = true;
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) {
                // A tap opens the app. Do not launch a microphone session or a
                // full-screen activity unexpectedly from a background callback.
                PendingIntent pi = PendingIntent.getActivity(this, 1, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                        ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
                getSystemService(NotificationManager.class).notify(NOTIF_ID + 1, builder
                        .setContentTitle("LifeOS heard your wake word")
                        .setContentText("Tap to open LifeOS, then tap the microphone")
                        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                        .setContentIntent(pi).setOnlyAlertOnce(true).setAutoCancel(true).build());
            }
            stopSelf();
            return true;
        }
        return false;
    }

    private void finishSession(String reason) {
        pauseListening();
        sessionEnded = true;
        updateNotification(reason);
        // Retain an honest status notification, but release the foreground
        // microphone service. Explicit opt-in is needed to start another session.
        stopForeground(false);
        stopSelf();
    }

    private void pauseListening() {
        handler.removeCallbacks(resume);
        ++generation;
        EmbeddedSpeechEngine.Session old = recognizer;
        recognizer = null;
        if (old != null) old.stop();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || "stop".equals(intent.getAction()) || !enabled()
                || checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
            pauseListening();
            getSystemService(NotificationManager.class).cancel(NOTIF_ID);
            getSystemService(NotificationManager.class).cancel(NOTIF_ID + 1);
            stopSelf();
            return START_NOT_STICKY;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String configured = prefs.getString(KEY_WAKE_WORD, "hey lifeos");
        wakeWord = configured == null || configured.trim().isEmpty() ? "hey lifeos" : configured.trim().toLowerCase(Locale.ROOT);
        try {
            startForeground(NOTIF_ID, notification(appForeground
                    ? "Wake listener paused while LifeOS is open" : "Starting optional wake session"));
            started = true;
            sessionEnded = false;
            startListening();
        } catch (RuntimeException e) { stopSelf(); }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        destroyed = true;
        pauseListening();
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
