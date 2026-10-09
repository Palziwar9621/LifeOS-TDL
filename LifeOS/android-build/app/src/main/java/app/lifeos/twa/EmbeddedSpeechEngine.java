package app.lifeos.twa;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** App-owned PCM -> bundled Vosk. No SpeechRecognizer, UI tones or network ASR. */
final class EmbeddedSpeechEngine {
    private static final int SAMPLE_RATE = 16_000;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> new Thread(r, "lifeos-offline-speech"));
    private static Model model; // Worker-confined, shared across foreground/background sessions.
    private static Session active; // Protected by EmbeddedSpeechEngine.class.

    interface Listener {
        void onReady(boolean echoCancellation);
        void onText(String text, boolean isFinal);
        void onError(String error);
    }

    private EmbeddedSpeechEngine() {}

    static synchronized Session start(Context context, Listener listener) {
        Session session = new Session(context.getApplicationContext(), listener);
        if (active != null && !active.cancelled) {
            MAIN.post(() -> listener.onError("microphone_in_use"));
            session.cancelled = true;
            return session;
        }
        active = session;
        WORKER.execute(session::run);
        return session;
    }

    /** OS memory pressure can evict an idle cache; routine mic stop never reloads the model. */
    static void releaseIdleModel() {
        synchronized (EmbeddedSpeechEngine.class) {
            if (active != null && !active.cancelled) return;
        }
        WORKER.execute(() -> {
            synchronized (EmbeddedSpeechEngine.class) {
                if (active != null && !active.cancelled) return;
                if (model != null) { model.close(); model = null; }
            }
        });
    }

    private static Model loadModel(Context context) throws IOException {
        if (model == null) {
            File directory = SpeechModelStore.prepare(new File(context.getNoBackupFilesDir(), "speech-models"),
                    () -> context.getAssets().open(SpeechModelStore.ASSET));
            LibVosk.vosk_set_log_level(-1);
            model = new Model(directory.getAbsolutePath());
        }
        return model;
    }

    static final class Session {
        private final Context context;
        private final Listener listener;
        private final Object recordingLock = new Object();
        private volatile boolean cancelled;
        private volatile int decodeEpoch;
        private AudioRecord recorder; // start/stop serialized with recordingLock.

        private Session(Context context, Listener listener) { this.context = context; this.listener = listener; }

        void resetDecoder() { decodeEpoch++; }

        void stop() {
            cancelled = true;
            // Stop capture synchronously BEFORE a WebView permission grant or
            // another owner takes the microphone. Native decoder cleanup follows
            // on the worker; never join a model-loading thread on the UI thread.
            synchronized (recordingLock) {
                if (recorder != null) { try { recorder.stop(); } catch (IllegalStateException ignored) {} }
            }
            synchronized (EmbeddedSpeechEngine.class) { if (active == this) active = null; }
        }

        private void emit(String text, boolean isFinal, int epoch) {
            MAIN.post(() -> {
                if (!cancelled && decodeEpoch == epoch) listener.onText(text, isFinal);
            });
        }

        private void run() {
            AcousticEchoCanceler echo = null;
            Recognizer decoder = null;
            String failure = null;
            try {
                if (cancelled) return;
                Model shared = loadModel(context);
                if (cancelled) return;
                decoder = new Recognizer(shared, SAMPLE_RATE);
                int minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new IOException("audio_format_unavailable");
                final boolean aec;
                synchronized (recordingLock) {
                    if (cancelled) return;
                    recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
                            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 6400));
                    if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                        recorder.release();
                        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 6400));
                    }
                    if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("audio_capture_unavailable");
                    try {
                        if (AcousticEchoCanceler.isAvailable()) {
                            echo = AcousticEchoCanceler.create(recorder.getAudioSessionId());
                            if (echo != null) echo.setEnabled(true);
                        }
                    } catch (RuntimeException ignored) { /* Optional OEM effect; keep text echo guard. */ }
                    aec = echo != null && echo.getEnabled();
                    recorder.startRecording();
                    if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IOException("audio_capture_unavailable");
                }
                MAIN.post(() -> { if (!cancelled) listener.onReady(aec); });
                short[] pcm = new short[1600]; // 100 ms mono; never stored or uploaded.
                int epoch = decodeEpoch;
                String lastPartial = "";
                while (!cancelled) {
                    if (epoch != decodeEpoch) { epoch = decodeEpoch; decoder.reset(); lastPartial = ""; }
                    int count = recorder.read(pcm, 0, pcm.length, AudioRecord.READ_BLOCKING);
                    if (cancelled) break;
                    if (count <= 0) throw new IOException("audio_capture_failed");
                    boolean complete = decoder.acceptWaveForm(pcm, count);
                    String text = new JSONObject(complete ? decoder.getResult() : decoder.getPartialResult())
                            .optString(complete ? "text" : "partial", "").trim();
                    text = SpeechText.wakeSpelling(text);
                    if (complete) {
                        emit(text, true, epoch);
                        lastPartial = "";
                    } else if (!text.isEmpty() && !text.equals(lastPartial)) {
                        emit(text, false, epoch);
                        lastPartial = text;
                    }
                    // Empty endpoint results represent silence, not an error.
                    // Keep the same AudioRecord and decoder for the whole consented session.
                }
            } catch (SecurityException e) { failure = "9"; }
            catch (LinkageError e) { failure = "embedded_engine_unavailable"; }
            catch (Exception e) { failure = "offline_speech_failed"; }
            finally {
                synchronized (recordingLock) {
                    if (recorder != null) {
                        try { recorder.stop(); } catch (IllegalStateException ignored) {}
                        recorder.release();
                        recorder = null;
                    }
                    if (echo != null) echo.release();
                }
                if (decoder != null) decoder.close();
                synchronized (EmbeddedSpeechEngine.class) { if (active == this) active = null; }
                if (failure != null && !cancelled) {
                    final String error = failure;
                    MAIN.post(() -> { if (!cancelled) listener.onError(error); });
                }
            }
        }
    }
}
