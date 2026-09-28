package app.lifeos.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
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

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Voice assistant", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Listens for your wake word");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        startForeground(NOTIF_ID, buildNotification());

        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        wakeWord = p.getString(KEY_WAKE_WORD, "hey lifeos");
        startListening();
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
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
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
        recognizer.startListening(i);
    }

    private boolean heardWake(String t) {
        if (t == null) return false;
        if (!t.toLowerCase().contains(wakeWord)) return false;
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
        return true;
    }

    private void restart() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        // Small delay avoids tight-looping when the mic service is busy.
        new android.os.Handler(getMainLooper()).postDelayed(this::startListening, 500);
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
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
