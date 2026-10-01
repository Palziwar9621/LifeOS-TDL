package app.lifeos.twa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.content.Context;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.RecognitionListener;
import android.speech.tts.TextToSpeech;
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

    // Native TTS: the Android WebView does NOT implement window.speechSynthesis,
    // so the assistant could hear commands but never reply out loud. This fills
    // the gap; the web layer calls it when window.speechSynthesis is missing.
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean micWasContinuous = false;
    private boolean ttsInitializing = false;
    private String pendingSpeech;
    private String pendingListenMode;

    // Beep suppression WITHOUT muting STREAM_MUSIC — muting that stream also
    // muted our own TTS replies (they share it), which made the assistant go
    // silent while the recognition beeps kept playing on some devices.
    //
    // Instead we use the proper mechanism: a transient audio focus request
    // with ATTRIBUTE_USAGE=ASSISTANT. Google's recognition service ducks/
    // silences its own UI sounds when another ASSISTANT-usage client holds
    // focus, and TTS replies remain fully audible because nothing is muted.
    // A watchdog releases focus after 15s no matter what, so focus can never
    // be held forever (a stuck focus killed playback once already).
    private AudioFocusRequest focusRequest;
    private boolean holdingFocus = false;
    private final Runnable releaseFocusRunnable = this::releaseBeepFocus;

    private void requestBeepSuppression() {
        activity.runOnUiThread(() -> {
            try {
                AudioManager am = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
                if (am == null) return;
                if (focusRequest == null) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(new AudioAttributes.Builder()
                             .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                        .setOnAudioFocusChangeListener(focusChange -> { /* transient; nothing to pause */ })
                        .build();
                }
                if (!holdingFocus) {
                    holdingFocus = am.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
                }
                // Watchdog: never hold focus longer than 15s per listen cycle.
                android.os.Handler h = new android.os.Handler(activity.getMainLooper());
                h.removeCallbacks(releaseFocusRunnable);
                h.postDelayed(releaseFocusRunnable, 15_000);
            } catch (Exception ignored) {}
        });
    }

    private void releaseBeepFocus() {
        activity.runOnUiThread(() -> {
            try {
                if (holdingFocus && focusRequest != null) {
                    AudioManager am = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
                    if (am != null) am.abandonAudioFocusRequest(focusRequest);
                    holdingFocus = false;
                }
                android.os.Handler h = new android.os.Handler(activity.getMainLooper());
                h.removeCallbacks(releaseFocusRunnable);
            } catch (Exception ignored) {}
        });
    }

    public SpeechBridge(Activity activity) {
        this.activity = activity;
        activity.runOnUiThread(this::initTts);
    }

    private void initTts() {
        if (tts != null || ttsInitializing) return;
        ttsInitializing = true;
        tts = new TextToSpeech(activity.getApplicationContext(), status -> {
            ttsInitializing = false;
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                try { tts.setLanguage(Locale.getDefault()); } catch (Exception ignored) {}
                if (pendingSpeech != null) { String text = pendingSpeech; pendingSpeech = null; speakInternal(text); }
            } else if (pendingSpeech != null) {
                pendingSpeech = null;
                fire("onSpeakEnd", "unavailable");
            }
        });
    }

    /** Speak text out loud (web falls back here when speechSynthesis is absent). */
    @JavascriptInterface
    public String speak(String text) {
        if (text == null || text.isEmpty()) return "noop";
        activity.runOnUiThread(() -> {
            releaseBeepFocus(); // replies must be fully audible
            if (!ttsReady) { pendingSpeech = text; initTts(); }
            else speakInternal(text);
        });
        return "speaking";
    }

    private void speakInternal(String text) {
        releaseBeepFocus();
        if (tts == null || !ttsReady) { fire("onSpeakEnd", "unavailable"); return; }
        // Pause recognition while talking (anti-feedback), resume after.
        micWasContinuous = continuous;
        if (recognizer != null) { try { recognizer.stopListening(); } catch (Exception ignored) {} }
        tts.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) {
                if (micWasContinuous) restartIfContinuous("continuous");
                fire("onSpeakEnd", "done");
            }
            @Override public void onError(String id) {
                if (micWasContinuous) restartIfContinuous("continuous");
                fire("onSpeakEnd", "error");
            }
        });
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "lifeos" + System.currentTimeMillis());
    }

    @JavascriptInterface
    public String stopSpeak() {
        activity.runOnUiThread(() -> {
            if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
        });
        return "stopped";
    }

    @JavascriptInterface
    public boolean ttsAvailable() {
        return true; // engine installs/initializes lazily on first speak()
    }

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
            continuous = true;
            if (activity.checkSelfPermission("android.permission.RECORD_AUDIO") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                pendingListenMode = "continuous";
                activity.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, 2002);
                return;
            }
            startListening("continuous");
        });
        return "started";
    }

    @JavascriptInterface
    public String stopContinuous() {
        activity.runOnUiThread(() -> {
            continuous = false;
            pendingListenMode = null;
            releaseBeepFocus();
            if (recognizer != null) {
                try { recognizer.stopListening(); } catch (Exception ignored) {}
                try { recognizer.destroy(); } catch (Exception ignored) {}
                recognizer = null;
            }
        });
        return "stopped";
    }

    public void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != 2002 || pendingListenMode == null) return;
        String mode = pendingListenMode;
        pendingListenMode = null;
        if (grantResults != null && grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            startListening(mode);
        } else {
            continuous = false;
            fire("onSpeechError", "9");
        }
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
                    releaseBeepFocus();
                    if (list != null && !list.isEmpty()) fire("onSpeechResult", list.get(0));
                    else fire("onSpeechError", "no_match");
                    if (mode == null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
                    else restartIfContinuous(mode);
                }
                @Override public void onError(int error) {
                    releaseBeepFocus();
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
            // On-device recognition is beep-free (the network service plays its
            // "tui"/"tunun" blips on every start/stop). This is the primary
            // sound fix; the audio-focus request below covers devices that have
            // no on-device model and fall back to the network recognizer.
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            requestBeepSuppression(); // transient focus: silences the service's blips, keeps TTS audible
            recognizer.startListening(intent);
        } catch (Exception e) {
            releaseBeepFocus();
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
