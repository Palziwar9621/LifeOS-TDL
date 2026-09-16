// LifeOS — idea instant capture: camera photo + voice note.
// Media is captured via getUserMedia/MediaRecorder, compressed to fit inside
// the idea row (photo ≲100 KB JPEG, voice ≲2 min Opus/WebM), so it syncs
// through the existing outbox/realtime machinery without extra plumbing.

export interface CapturedPhoto {
  dataUrl: string;   // data:image/jpeg;base64,...
  width: number;
  height: number;
}

export interface VoiceRecording {
  dataUrl: string;           // data:audio/webm;base64,... (or audio/mp4 on iOS)
  mimeType: string;
  durationSecs: number;
}

export function isCaptureSupported(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';
}

// ------------------------------------------------------------------
// Camera photo
// ------------------------------------------------------------------

/** Downscale an image bitmap to a JPEG data URL under ~maxKB. */
async function bitmapToJpeg(bmp: ImageBitmap, maxKB: number): Promise<CapturedPhoto> {
  const canvas = document.createElement('canvas');
  let w = bmp.width, h = bmp.height;
  const maxDim = 1280;
  if (Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  let quality = 0.8;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > maxKB * 1024 * 1.37 && quality > 0.35) { // base64 ≈ 1.37x raw
    quality -= 0.15;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  bmp.close?.();
  return { dataUrl, width: w, height: h };
}

/** Pick the best available rear-ish camera; falls back to any camera. */
async function pickCamera(): Promise<MediaStream> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    // Prefer an environment-facing (rear) camera by constraint attempt order.
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } } },
      { video: { facingMode: 'environment' } },
      { video: true },
    ];
    for (const c of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(c); } catch { /* try next */ }
    }
    void cams;
    throw new Error('No camera available');
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') throw new Error('Camera permission denied. Allow camera access in your browser/app settings.');
    if (e?.name === 'NotFoundError') throw new Error('No camera found on this device.');
    throw new Error('Could not start the camera. ' + (e?.message ?? ''));
  }
}

// ------------------------------------------------------------------
// Live camera preview (viewfinder) — user frames the shot, then taps shutter.
// ------------------------------------------------------------------

export interface CameraPreview {
  /** Live stream — attach to a <video> element (playsInline, muted). */
  stream: MediaStream;
  /** Snap the current frame; resolves with the compressed photo. */
  snap: () => Promise<CapturedPhoto>;
  /** Switch between front/back cameras where the device supports it. */
  flip: () => Promise<void>;
  /** Stop the camera and release it. */
  stop: () => void;
  videoWidth: () => number;
  videoHeight: () => number;
}

let activePreview: CameraPreview | null = null;
let facing: 'environment' | 'user' = 'environment';

export async function openCameraPreview(): Promise<CameraPreview> {
  if (activePreview) activePreview.stop();
  let stream: MediaStream;
  try {
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } } },
      { video: { facingMode: facing } },
      { video: true },
    ];
    let opened: MediaStream | null = null;
    for (const c of attempts) {
      try { opened = await navigator.mediaDevices.getUserMedia(c); break; } catch { /* next */ }
    }
    if (!opened) throw new Error('No camera available');
    stream = opened;
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') throw new Error('Camera permission denied. Allow camera access in your browser/app settings.');
    if (e?.name === 'NotFoundError') throw new Error('No camera found on this device.');
    throw new Error('Could not start the camera. ' + (e?.message ?? ''));
  }

  const snap = async (): Promise<CapturedPhoto> => {
    const video = videoEl;
    if (!video || video.videoWidth === 0) throw new Error('Camera is still warming up — try in a second.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    // Mirror the frame when using the front camera so it matches the preview.
    if (facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', 0.9));
    const bmp = await createImageBitmap(blob);
    return bitmapToJpeg(bmp, 140);
  };

  const flip = async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    stream.getTracks().forEach((t) => t.stop());
    activePreview = null;
    const next = await openCameraPreview();
    activePreview = next;
    // Hand the new stream back for the caller to attach.
    onSwap?.(next.stream);
  };

  let videoEl: HTMLVideoElement | null = null;
  let onSwap: ((s: MediaStream) => void) | null = null;

  const preview: CameraPreview = {
    stream,
    snap,
    flip,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      if (activePreview === preview) activePreview = null;
    },
    videoWidth: () => videoEl?.videoWidth ?? 0,
    videoHeight: () => videoEl?.videoHeight ?? 0,
  };

  // Caller registers its <video> element via the extended API below.
  (preview as any).attach = (el: HTMLVideoElement) => {
    videoEl = el;
    el.srcObject = stream;
    el.playsInline = true;
    el.muted = true;
    void el.play().catch(() => undefined);
  };
  (preview as any).onStreamSwap = (cb: (s: MediaStream) => void) => { onSwap = cb; };

  activePreview = preview;
  return preview;
}

// ------------------------------------------------------------------
// One-shot capture (kept for quick paths that don't need a preview)
// ------------------------------------------------------------------
export function capturePhoto(): Promise<CapturedPhoto> {
  return new Promise((resolve, reject) => {
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    const cleanup = () => {
      stream?.getTracks().forEach((t) => t.stop());
      video?.remove();
    };
    (async () => {
      try {
        stream = await pickCamera();
        video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
        // Wait until dimensions are real (some mobile browsers lag one frame).
        await new Promise<void>((r) => {
          if (video!.videoWidth > 0) return r();
          video!.onloadedmetadata = () => r();
        });
        // Give autofocus a beat.
        await new Promise((r) => setTimeout(r, 350));
        const track = stream.getVideoTracks()[0] as any;
        const blob = await new Promise<Blob>((res, rej) => {
          if (typeof ImageCapture !== 'undefined' && track?.grabFrame) {
            track.grabFrame()
              .then(async (frame: any) => res(await new Promise<Blob>((r2) => (frame as ImageBitmap as any).convertToBlob ? (frame as any).convertToBlob({ type: 'image/jpeg' }).then((b: Blob) => r2(b)) : res(new Blob()))))
              .catch(() => res(new Blob()));
          } else {
            // Universal path: draw the current video frame to a canvas.
            const canvas = document.createElement('canvas');
            canvas.width = video!.videoWidth;
            canvas.height = video!.videoHeight;
            canvas.getContext('2d')!.drawImage(video!, 0, 0);
            canvas.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', 0.9);
          }
        });
        cleanup();
        if (blob.size === 0) {
          // grabFrame path returned nothing usable — redo via canvas of last frame
          reject(new Error('Capture failed — try again.'));
          return;
        }
        const bmp = await createImageBitmap(blob);
        resolve(await bitmapToJpeg(bmp, 140));
      } catch (e: any) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

/** Fallback for desktops without usable getUserMedia: file picker. */
export function pickPhotoFile(maxKB = 140): Promise<CapturedPhoto | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        const bmp = await createImageBitmap(f);
        resolve(await bitmapToJpeg(bmp, maxKB));
      } catch { resolve(null); }
    };
    input.click();
  });
}

// ------------------------------------------------------------------
// Voice note
// ------------------------------------------------------------------

const VOICE_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickVoiceMime(): string {
  for (const m of VOICE_MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return '';
}

export interface VoiceSession {
  stop: () => Promise<VoiceRecording>;
  cancel: () => void;
  /** Live elapsed seconds — call this on a timer to show a counter. */
  elapsedSecs: () => number;
  /** Pause capture. Audio already recorded is kept; timer freezes. */
  pause: () => void;
  /** Resume from a pause — appends to the same recording. */
  resume: () => void;
  isPaused: () => boolean;
}

const MAX_VOICE_SECS = 120; // keep the row small enough to sync briskly

export async function startVoiceRecording(): Promise<VoiceSession> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') throw new Error('Microphone permission denied. Allow mic access in your browser/app settings.');
    if (e?.name === 'NotFoundError') throw new Error('No microphone found on this device.');
    throw new Error('Could not start recording. ' + (e?.message ?? ''));
  }
  const mimeType = pickVoiceMime();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let pausedMs = 0;          // accumulated time spent paused
  let pauseStartedAt: number | null = null;
  let paused = false;
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start(500); // gather in 0.5s chunks

  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  /** Recorded seconds excluding paused time. */
  const activeSecs = () =>
    Math.max(0, Math.round(((Date.now() - startedAt) - pausedMs - (pauseStartedAt ? Date.now() - pauseStartedAt : 0)) / 1000));

  const pause = () => {
    if (paused || rec.state !== 'recording') return;
    rec.pause();
    paused = true;
    pauseStartedAt = Date.now();
  };

  const resume = () => {
    if (!paused || rec.state !== 'paused') return;
    if (pauseStartedAt) pausedMs += Date.now() - pauseStartedAt;
    pauseStartedAt = null;
    paused = false;
    rec.resume();
  };

  const isPaused = () => paused;

  const stop = async (): Promise<VoiceRecording> => {
    if (pauseStartedAt) pausedMs += Date.now() - pauseStartedAt;
    const durationSecs = Math.min(MAX_VOICE_SECS, activeSecs());
    if (rec.state !== 'inactive') {
      rec.stop();
      await stopped;
    }
    stream.getTracks().forEach((t) => t.stop());
    const type = rec.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('Could not encode the recording.'));
      fr.readAsDataURL(blob);
    });
    return { dataUrl, mimeType: type, durationSecs };
  };

  const cancel = () => {
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
  };

  // Hard cap: auto-stop at 2 minutes so nothing runs away silently.
  const autoStop = setTimeout(() => {
    if (rec.state !== 'inactive') { try { rec.pause(); } catch { /* already stopped */ } }
  }, MAX_VOICE_SECS * 1000);
  rec.addEventListener('stop', () => clearTimeout(autoStop), { once: true });

  return { stop, cancel, elapsedSecs: activeSecs, pause, resume, isPaused };
}
