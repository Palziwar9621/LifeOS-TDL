package app.lifeos.twa;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/** Native WebView speech. All mutable session state is confined to the main looper. */
public class SpeechBridge {
    private static final int REQ_MIC = 2002;
    private final Activity activity;
    private final Handler handler;
    private EmbeddedSpeechEngine.Session recognizer;
    private int recognitionGeneration;
    private boolean continuous;
    private volatile boolean destroyed;
    private boolean foreground;
    private boolean webMicrophoneInUse;
    private String pendingListenMode;
    private boolean permissionPending;
    private boolean permissionGranted;
    private Runnable listenTimeout;
    private boolean speechBeginning;
    private boolean outputMuted;
    private String playbackText = "";
    private long echoUntil;
    private volatile boolean echoCancellation;

    private TextToSpeech tts;
    // "initializing" is a usable queued state, not evidence of a missing engine.
    private volatile String ttsState = "initializing";
    private boolean ttsInitializing;
    private int ttsGeneration;
    private Runnable ttsInitTimeout;
    private String pendingSpeech;
    private String utterance;
    private long utteranceSequence;

    public SpeechBridge(Activity activity) {
        this.activity = activity;
        handler = new Handler(activity.getMainLooper());
        handler.post(this::initTts);
    }

    private boolean canUsePage() {
        return !destroyed && foreground && !activity.isFinishing() && !activity.isDestroyed()
                && (!(activity instanceof MainActivity) || ((MainActivity) activity).isTrustedPage());
    }

    private void initTts() {
        if (destroyed || tts != null || ttsInitializing) return;
        ttsInitializing = true;
        ttsState = "initializing";
        final int generation = ++ttsGeneration;
        ttsInitTimeout = () -> onTtsInitialized(generation, TextToSpeech.ERROR);
        handler.postDelayed(ttsInitTimeout, 15_000);
        try {
            // Always post the callback: some engines finish before the constructor
            // returns, while others call back on a binder thread.
            tts = new TextToSpeech(activity.getApplicationContext(), status ->
                    handler.post(() -> onTtsInitialized(generation, status)));
        } catch (Exception e) {
            onTtsInitialized(generation, TextToSpeech.ERROR);
        }
    }

    private void onTtsInitialized(int generation, int status) {
        if (destroyed || generation != ttsGeneration) return;
        ++ttsGeneration;
        if (ttsInitTimeout != null) handler.removeCallbacks(ttsInitTimeout);
        ttsInitTimeout = null;
        ttsInitializing = false;
        boolean ready = status == TextToSpeech.SUCCESS && tts != null;
        if (ready) {
            try {
                int language = tts.setLanguage(Locale.getDefault());
                ready = language != TextToSpeech.LANG_MISSING_DATA
                        && language != TextToSpeech.LANG_NOT_SUPPORTED;
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { handler.post(() -> finishSpeech(id, "done")); }
                    @Override public void onError(String id) { handler.post(() -> finishSpeech(id, "error")); }
                    @Override public void onStop(String id, boolean interrupted) {
                        handler.post(() -> finishSpeech(id, "cancelled"));
                    }
                });
            } catch (Exception e) { ready = false; }
        }
        ttsState = ready ? "ready" : "unavailable";
        if (!ready && tts != null) {
            try { tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
        if (pendingSpeech != null) {
            String text = pendingSpeech;
            pendingSpeech = null;
            if (ready && canUsePage()) speakInternal(text);
            else if (canUsePage()) {
                fire("onSpeakEnd", "unavailable");
            }
        }
    }

    @JavascriptInterface
    public boolean ttsAvailable() { return !"unavailable".equals(ttsState); }

    @JavascriptInterface
    public String getTtsState() { return ttsState; }

    @JavascriptInterface
    public String speak(String text) {
        if (text == null || text.trim().isEmpty()) return "noop";
        handler.post(() -> {
            if (!canUsePage()) return;
            // Latest request wins, like QUEUE_FLUSH. Invalidate the previous ID
            // BEFORE stop(), so late onDone/onStop cannot finish the new reply.
            stopSpeech(false);
            playbackText = text;
            speechBeginning = false;
            // Keep app-owned PCM running for spoken interruption. Reset only
            // the decoder's previous phrase; there is no microphone restart.
            if (recognizer != null) recognizer.resetDecoder();
            if (!"ready".equals(ttsState)) {
                pendingSpeech = text;
                initTts();
            } else speakInternal(text);
        });
        return "speaking";
    }

    private void speakInternal(String text) {
        if (!canUsePage()) return;
        if (tts == null || !"ready".equals(ttsState)) {
            fire("onSpeakEnd", "unavailable");
            return;
        }
        utterance = "lifeos-" + (++utteranceSequence);
        playbackText = text;
        try {
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), utterance) == TextToSpeech.ERROR) {
                finishSpeech(utterance, "error");
            }
        } catch (Exception e) { finishSpeech(utterance, "error"); }
    }

    private void finishSpeech(String id, String status) {
        if (destroyed || id == null || !id.equals(utterance)) return;
        utterance = null;
        echoUntil = SystemClock.elapsedRealtime() + 800;
        fire("onSpeakEnd", status);
    }

    private void stopSpeech(boolean notify) {
        boolean hadSpeech = pendingSpeech != null || utterance != null;
        pendingSpeech = null;
        utterance = null;
        if (hadSpeech) echoUntil = SystemClock.elapsedRealtime() + 800;
        if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
        if (notify && hadSpeech) fire("onSpeakEnd", "cancelled");
    }

    @JavascriptInterface
    public String stopSpeak() {
        // The web caller resolves its cancelled speech synchronously. A later
        // onSpeakEnd would hit the global callback for its replacement reply.
        handler.post(() -> stopSpeech(false));
        return "stopped";
    }

    @JavascriptInterface
    public String listen() {
        handler.post(() -> requestListening(false));
        return "started";
    }

    @JavascriptInterface
    public String startContinuous() {
        handler.post(() -> requestListening(true));
        return "started";
    }

    @JavascriptInterface
    public String stopContinuous() {
        handler.post(this::stopRecognitionSession);
        return "stopped";
    }

    /** Optional explicit cancel API; stopContinuous still cancels one-shot listens too. */
    @JavascriptInterface
    public String cancel() {
        handler.post(() -> {
            stopRecognitionSession();
            stopSpeech(false);
        });
        return "stopped";
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return !destroyed; // Bundled engine; actual load/mic failures are asynchronous.
    }

    @JavascriptInterface
    public String recognitionEngine() { return "vosk-en-us-0.15"; }

    /** Web mic ducking gates text, never a system audio stream or PCM capture. */
    @JavascriptInterface
    public void setMuted(boolean muted) { handler.post(() -> outputMuted = muted); }

    @JavascriptInterface
    public boolean echoCancellationAvailable() { return echoCancellation; }

    private void requestListening(boolean requestedContinuous) {
        if (!canUsePage()) return;
        if (webMicrophoneInUse) { fire("onSpeechError", "microphone_in_use"); return; }
        if (recognizer != null && continuous == requestedContinuous) return;
        continuous = requestedContinuous;
        // Explicit reactivation can interrupt playback. An already-active
        // continuous session remains alive throughout native TTS.
        stopSpeech(true);
        cancelRecognition();
        if (activity.checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
            pendingListenMode = requestedContinuous ? "continuous" : "once";
            if (!permissionPending) {
                permissionPending = true;
                activity.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, REQ_MIC);
            }
            return;
        }
        startListening();
    }

    private void startListening() {
        if (!canUsePage() || webMicrophoneInUse || recognizer != null) return;
        if (activity.checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
            endRecognitionError("9");
            return;
        }
        cancelListenTimeout();
        speechBeginning = false;
        final int generation = ++recognitionGeneration;
        fire("onSpeechState", "loading");
        recognizer = EmbeddedSpeechEngine.start(activity, new EmbeddedSpeechEngine.Listener() {
            private boolean current() { return !destroyed && generation == recognitionGeneration && canUsePage(); }
            @Override public void onReady(boolean aec) {
                if (!current()) return;
                echoCancellation = aec;
                fire("onSpeechReady", "");
                if (!continuous) {
                    listenTimeout = () -> { if (current()) endRecognitionError("6"); };
                    handler.postDelayed(listenTimeout, 20_000);
                }
            }
            @Override public void onText(String text, boolean isFinal) {
                if (!current()) return;
                boolean outputActive = pendingSpeech != null || utterance != null || outputMuted;
                boolean accepted = !text.isEmpty() && (speechBeginning || SpeechText.accept(text, playbackText,
                        outputActive, SystemClock.elapsedRealtime() < echoUntil));
                if (accepted) {
                    if (!speechBeginning) {
                        speechBeginning = true;
                        // This event follows the first non-echo recognized words,
                        // not raw amplitude that could be the loudspeaker itself.
                        if (outputActive) stopSpeech(true);
                        fire("onSpeechBeginning", "");
                    }
                    if (isFinal && !continuous) stopRecognitionSession();
                    fire(isFinal ? "onSpeechResult" : "onSpeechPartial", text);
                }
                if (isFinal) speechBeginning = false;
            }
            @Override public void onError(String error) { if (current()) endRecognitionError(error); }
        });
    }

    private void endRecognitionError(String error) {
        // Capture/model failures end the session; no automatic retry or fallback
        // to a system recognizer. Ordinary PCM silence is not a failure.
        stopRecognitionSession();
        fire("onSpeechError", error);
        fire("onSpeechStopped", error);
    }

    private void cancelListenTimeout() {
        if (listenTimeout != null) handler.removeCallbacks(listenTimeout);
        listenTimeout = null;
    }

    private void cancelRecognition() {
        cancelListenTimeout();
        ++recognitionGeneration;
        speechBeginning = false;
        EmbeddedSpeechEngine.Session old = recognizer;
        recognizer = null;
        if (old != null) old.stop();
    }

    private void stopRecognitionSession() {
        continuous = false;
        outputMuted = false;
        pendingListenMode = null;
        permissionGranted = false;
        cancelRecognition();
    }

    public void onPermissionResult(int requestCode, int[] results) {
        if (requestCode != REQ_MIC) return;
        permissionPending = false;
        if (pendingListenMode == null || destroyed) return;
        permissionGranted = results != null && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (!permissionGranted) { endRecognitionError("9"); return; }
        resumePermissionListen();
    }

    private void resumePermissionListen() {
        if (!permissionGranted || pendingListenMode == null || !canUsePage()) return;
        continuous = "continuous".equals(pendingListenMode);
        pendingListenMode = null;
        permissionGranted = false;
        startListening();
    }

    /** MainActivity's getUserMedia tracker prevents native/web recorder overlap. */
    @JavascriptInterface
    public void setWebMicrophoneInUse(boolean inUse) {
        // A track's final release may arrive after onPause. Accept that release
        // so a transient dialog cannot leave a stale microphone reservation.
        handler.post(() -> { if (!destroyed && (canUsePage() || !inUse)) onWebMicrophoneChanged(inUse); });
    }

    void onWebMicrophoneChanged(boolean inUse) {
        webMicrophoneInUse = inUse;
        if (inUse) {
            stopRecognitionSession();
            stopSpeech(true);
        }
    }

    public void onResume() {
        foreground = true;
        resumePermissionListen();
    }

    public void onPause() {
        if (recognizer != null) fire("onSpeechStopped", "paused");
        foreground = false;
        continuous = false;
        outputMuted = false;
        cancelRecognition();
        stopSpeech(false);
        // A permission dialog may pause the activity. Only that in-flight user
        // request may resume; ordinary foreground return always stays idle.
        if (!permissionPending) {
            pendingListenMode = null;
            permissionGranted = false;
        }
    }

    public void onPageChanged() {
        stopRecognitionSession();
        stopSpeech(false);
        webMicrophoneInUse = false;
    }

    public void destroy() {
        onPageChanged();
        destroyed = true;
        foreground = false;
        ++ttsGeneration;
        handler.removeCallbacksAndMessages(null);
        if (tts != null) { try { tts.shutdown(); } catch (Exception ignored) {} }
        tts = null;
        ttsState = "unavailable";
    }

    private void fire(String event, String text) {
        if (!canUsePage()) return;
        String js = "window.__lifeosSpeech && typeof window.__lifeosSpeech." + event
                + " === 'function' && window.__lifeosSpeech." + event + "("
                + org.json.JSONObject.quote(text) + ")";
        if (activity instanceof MainActivity) ((MainActivity) activity).evaluateJs(js);
    }
}
