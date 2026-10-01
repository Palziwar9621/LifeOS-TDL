package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Background wake-word listener.
 *
 * A foreground service (foregroundServiceType="microphone") that keeps a
 * SpeechRecognizer running even when the app is closed. On "Hey LifeOS" it
 * raises a full-screen intent notification — the user taps it (Android
 * requires a touch for background activation) and the app opens straight
 * into command mode.
 *
 * Battery-friendly: recognition restarts only on end/error, and the whole
 * service is started/stopped from the web app via LifeOSAssistantBridge.
 */
public class AssistantService extends Service {
    private static final String CHANNEL = "lifeos_assistant";
    private static final int NOTIF_ID = 2001;
    public static final String PREFS = "lifeos_assistant";
    public static final String KEY_ENABLED = "wake_enabled";
    public static final String KEY_WAKE_WORD = "wake_word";

    private SpeechRecognizer recognizer;
    private String wakeWord = "hey lifeos";
    private long lastWakeFiredAt = 0;
    private long pausedUntil = 0;
    private boolean appForeground = false;
    private final android.os.Handler handler = new android.os.Handler(getMainLooper());

    private static AssistantService instance;

    /** The wake-word listener is ONLY for when the app is closed. While the
     *  app is open its recognizer must be destroyed — otherwise it holds the
     *  mic and the in-app idea recorder fails with "LifeOS is recording". */
    public static void setAppForeground(boolean fg) {
        appForegroundStatic = fg;
        if (instance == null) return;
        instance.appForeground = fg;
        if (fg) instance.pauseListening();
        else instance.handler.postDelayed(instance::startListening, 400);
    }
    private static boolean appForegroundStatic = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        appForeground = appForegroundStatic;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Voice assistant", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Listens for your wake word");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        startForeground(NOTIF_ID, buildNotification());

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        wakeWord = p.getString(KEY_WAKE_WORD, "hey lifeos");
        if (!appForeground) startListening();
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setContentTitle("LifeOS is listening")
                .setContentText("Say \"" + wakeWord + "\" to give a command")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }

    private void startListening() {
        if (appForeground) return; // app is open — the mic belongs to the app
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
        // Pause window after a wake event: don't re-trigger while the popup
        // is up (and give the user time to speak the command).
        if (System.currentTimeMillis() < pausedUntil) {
            new android.os.Handler(getMainLooper()).postDelayed(this::startListening, 1000);
            return;
        }
        if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(this);

        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null) for (String t : list) if (heardWake(t)) return;
                restart();
            }
            @Override public void onError(int error) { restart(); }
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(Bundle partial) {
                ArrayList<String> list = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null) for (String t : list) if (heardWake(t)) return;
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });

        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString());
        // On-device recognition does not play the network service's start/stop
        // blips ("tui"/"tunun") — with a restart loop they'd beep every few
        // seconds. Falls back to the network recognizer silently when no
        // on-device model is installed.
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        recognizer.startListening(i);
    }

    private boolean heardWake(String t) {
        if (t == null) return false;
        if (!t.toLowerCase().contains(wakeWord)) return false;
        long now = System.currentTimeMillis();
        if (now - lastWakeFiredAt < 20_000) return true; // cooldown: swallow repeats
        lastWakeFiredAt = now;
        // Wake word heard — surface a full-screen notification (opens the app
        // into command mode). Android requires user interaction to launch
        // activities from the background; the notification is that touch.
        NotificationManager nm = getSystemService(NotificationManager.class);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            open.putExtra("voice_command_mode", true);
            PendingIntent pi = PendingIntent.getActivity(this, 1, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new Notification.Builder(this, CHANNEL)
                    .setContentTitle("Listening for your command…")
                    .setContentText("Tap to speak to LifeOS")
                    .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                    .setFullScreenIntent(pi, true)
                    .setAutoCancel(true)
                    .build();
            nm.notify(NOTIF_ID + 1, n);
        }
        // Pause the loop so the popup isn't instantly re-triggered.
        pausedUntil = now + 20_000;
        if (recognizer != null) { try { recognizer.stopListening(); } catch (Exception ignored) {} }
        return true;
    }

    /** Destroy the recognizer and cancel every pending restart — releases
     *  the mic immediately (used when the app comes to the foreground). */
    private void pauseListening() {
        handler.removeCallbacksAndMessages(null);
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private void restart() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        // Recreate fresh: ERROR_CLIENT(5)/busy(8) mean the old instance is
        // wedged — a short delay plus a new object clears it.
        handler.postDelayed(this::startListening, 1200);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        handler.removeCallbacksAndMessages(null);
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
