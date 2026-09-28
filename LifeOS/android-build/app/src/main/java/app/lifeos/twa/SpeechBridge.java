package app.lifeos.twa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.RecognitionListener;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Exposed to the web app as window.LifeOSSpeech.
 *
 * The Android WebView does not implement the Web Speech API, so voice
 * commands would silently never work in the APK. This bridge runs Android's
 * native speech recognition (the same engine Google keyboard/Assistant use)
 * and feeds the final transcript back to the page via a JS callback.
 *
 * Lifecycle per utterance: the page calls listen() -> the system mic dialog
 * opens -> results arrive in onSpeechResult(text) / onSpeechError(code).
 */
public class SpeechBridge {
    private final Activity activity;
    private static final int REQ = 4711;
    private SpeechRecognizer recognizer;
    private boolean continuous = false;

    public SpeechBridge(Activity activity) { this.activity = activity; }

    /** One-shot listen: opens native recognition; result lands in the JS callback. */
    @JavascriptInterface
    public String listen() {
        // Must run on the UI thread. Ensure mic permission first.
        activity.runOnUiThread(() -> {
            if (activity.checkSelfPermission("android.permission.RECORD_AUDIO") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 2002);
                fire("onSpeechError", "9");
                return;
            }
            startListening(null);
        });
        return "started";
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return SpeechRecognizer.isRecognitionAvailable(activity.getApplicationContext());
    }

    /** Continuous path (used when the page wants wake-word mode). */
    @JavascriptInterface
    public String startContinuous() {
        activity.runOnUiThread(() -> {
            if (activity.checkSelfPermission("android.permission.RECORD_AUDIO") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 2002);
                fire("onSpeechError", "9");
                return;
            }
            continuous = true;
            startListening("continuous");
        });
        return "started";
    }

    @JavascriptInterface
    public String stopContinuous() {
        activity.runOnUiThread(() -> {
            continuous = false;
            if (recognizer != null) {
                try { recognizer.stopListening(); } catch (Exception ignored) {}
                try { recognizer.destroy(); } catch (Exception ignored) {}
                recognizer = null;
            }
        });
        return "stopped";
    }

    /** Restart a dead session (continuous mode): Android ends recognition
     *  after every utterance, so without this the mic dies after one command. */
    private void restartIfContinuous(String mode) {
        if (!continuous) return;
        activity.runOnUiThread(() -> {
            if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
            new android.os.Handler(activity.getMainLooper()).postDelayed(() -> startListening("continuous"), 300);
        });
    }

    private void startListening(String mode) {
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(activity.getApplicationContext())) {
                fire("onSpeechError", "not_available");
                return;
            }
            if (recognizer == null) recognizer = SpeechRecognizer.createSpeechRecognizer(activity.getApplicationContext());

            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onResults(Bundle results) {
                    ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (list != null && !list.isEmpty()) fire("onSpeechResult", list.get(0));
                    else fire("onSpeechError", "no_match");
                    if (mode == null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
                    else restartIfContinuous(mode);
                }
                @Override public void onError(int error) {
                    fire("onSpeechError", String.valueOf(error)); // 6=no speech, 7=no match, 8=busy
                    if (mode == null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
                    else restartIfContinuous(mode);
                }
                @Override public void onReadyForSpeech(Bundle params) { fire("onSpeechReady", ""); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (list != null && !list.isEmpty()) fire("onSpeechPartial", list.get(0));
                }
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toString());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            recognizer.startListening(intent);
            fire("onSpeechReady", "");
        } catch (Exception e) {
            fire("onSpeechError", "exception");
        }
    }

    private void fire(final String event, final String text) {
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) return;
            String js = "window.__lifeosSpeech && window.__lifeosSpeech." + event + "(" +
                org.json.JSONObject.quote(text) + ")";
            MainActivity.get().evaluateJs(js);
        });
    }
}
