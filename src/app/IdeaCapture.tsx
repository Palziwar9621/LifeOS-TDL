// LifeOS — instant idea capture: live camera viewfinder + voice note with pause/resume.
// Flow: tap Capture → camera preview opens in-frame → frame the shot → shutter →
// voice recording starts → pause/resume freely → Save. Both land on one idea.
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from '../ui/components';
import { useApp } from './store';
import { createIdea } from '../lib/db';
import {
  openCameraPreview, pickPhotoFile, startVoiceRecording, isCaptureSupported,
  type VoiceSession,
} from '../lib/media';
import type { CameraPreview } from '../lib/media';

interface Draft {
  photoData: string | null;
  voiceData: string | null;
  voiceDuration: number | null;
}

export function IdeaCaptureModal({ open, onClose, onCaptured }: {
  open: boolean;
  onClose: () => void;
  onCaptured: () => void;
}) {
  const { toast } = useApp();
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState<Draft>({ photoData: null, voiceData: null, voiceDuration: null });
  const [viewfinder, setViewfinder] = useState(false);   // live camera open
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<CameraPreview | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const timerRef = useRef<number | null>(null);

  // Reset each time the modal opens.
  useEffect(() => {
    if (open) {
      setTitle('');
      setDraft({ photoData: null, voiceData: null, voiceDuration: null });
      setViewfinder(false); setRecording(false); setPaused(false); setElapsed(0);
    }
  }, [open]);

  // Release camera / mic when the modal closes.
  useEffect(() => {
    if (!open) {
      previewRef.current?.stop(); previewRef.current = null; setViewfinder(false);
      sessionRef.current?.cancel(); sessionRef.current = null; setRecording(false);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [open]);

  useEffect(() => () => {
    previewRef.current?.stop();
    sessionRef.current?.cancel();
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const supported = isCaptureSupported();

  // ---- camera preview ----
  const openCamera = async () => {
    try {
      const preview = await openCameraPreview();
      previewRef.current = preview;
      setViewfinder(true);
      // Attach after render — the <video> mounts once viewfinder is true.
      requestAnimationFrame(() => {
        if (videoRef.current) (preview as any).attach(videoRef.current);
        (preview as any).onStreamSwap?.((s: MediaStream) => {
          if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => undefined); }
        });
      });
    } catch (e: any) {
      // No camera / blocked → fall back to file picker so the flow still works.
      const picked = await pickPhotoFile();
      if (picked) setDraft((d) => ({ ...d, photoData: picked.dataUrl }));
      else toast(e?.message ?? 'Could not open the camera', 'error');
    }
  };

  const closeCamera = () => {
    previewRef.current?.stop();
    previewRef.current = null;
    setViewfinder(false);
  };

  const shoot = async () => {
    setSnapping(true);
    try {
      const photo = await previewRef.current!.snap();
      setDraft((d) => ({ ...d, photoData: photo.dataUrl }));
      closeCamera();
      // Chain into the voice note right away (the whole point of the feature).
      if (supported) void beginRecording();
    } catch (e: any) {
      toast(e?.message ?? 'Capture failed — try again', 'error');
    } finally {
      setSnapping(false);
    }
  };

  // ---- voice ----
  const beginRecording = async () => {
    try {
      const session = await startVoiceRecording();
      sessionRef.current = session;
      setRecording(true); setPaused(false); setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(session.elapsedSecs()), 250);
    } catch (e: any) {
      toast(e?.message ?? 'Could not start recording', 'error');
    }
  };

  const togglePause = () => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.isPaused()) { s.resume(); setPaused(false); }
    else { s.pause(); setPaused(true); }
  };

  const stopRec = async (keep: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false); setPaused(false);
    if (!session) return;
    if (!keep) { session.cancel(); return; }
    try {
      const rec = await session.stop();
      if (rec.durationSecs < 1) { toast('Recording too short — try again', 'error'); return; }
      setDraft((d) => ({ ...d, voiceData: rec.dataUrl, voiceDuration: rec.durationSecs }));
    } catch (e: any) {
      toast(e?.message ?? 'Could not save the recording', 'error');
    }
  };

  const save = async () => {
    if (!title.trim() && !draft.photoData && !draft.voiceData) {
      toast('Add a photo, a voice note, or a title first', 'error');
      return;
    }
    try {
      await createIdea({
        title: title.trim() || (draft.voiceData ? 'Voice idea' : 'Photo idea'),
        description: draft.photoData && !title.trim() ? 'Captured from a quick photo moment.' : null,
        photo_data: draft.photoData,
        voice_data: draft.voiceData,
        voice_duration_secs: draft.voiceDuration,
      });
      toast('Idea captured! 📸', 'success');
      onCaptured();
      onClose();
    } catch (e: any) {
      toast(e?.message ?? 'Could not save the idea', 'error');
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <Modal open={open} onClose={() => { if (!recording && !viewfinder) onClose(); }} title="Capture an idea" wide>
      <p className="text-sm muted mb-3">Frame the shot, tap the shutter — then talk about it. Pause whenever you need to think.</p>
      <div className="space-y-4">
        <div>
          <label className="label">Title <span className="muted font-normal">(optional)</span></label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mural idea for the stairwell" autoFocus={!recording && !viewfinder} />
        </div>

        {/* ---------- LIVE VIEWFINDER ---------- */}
        {viewfinder && (
          <div className="relative rounded-xl overflow-hidden bg-black">
            <video ref={videoRef} className="w-full max-h-72 object-contain" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 bg-gradient-to-t from-black/70 to-transparent py-3">
              <button className="btn-ghost btn-sm text-white" aria-label="Switch camera" onClick={() => void previewRef.current?.flip()}>↻ Flip</button>
              <button
                className="h-14 w-14 rounded-full border-4 border-white bg-white/20 active:scale-95 transition disabled:opacity-50"
                aria-label="Take the photo"
                disabled={snapping}
                onClick={() => void shoot()}
              />
              <button className="btn-ghost btn-sm text-white" aria-label="Cancel camera" onClick={closeCamera}>✕</button>
            </div>
            {snapping && <div className="absolute inset-0 bg-white/70 animate-fade-in" />}
          </div>
        )}

        {/* ---------- CAPTURE ENTRY (hidden while viewfinder/recording) ---------- */}
        {!viewfinder && !recording && !draft.voiceData && (
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secondary h-24 flex-col gap-1.5" onClick={() => void openCamera()}>
              <span className="text-2xl">📸</span>
              <span className="text-sm font-semibold">{draft.photoData ? 'Retake photo' : 'Take a photo'}</span>
              <span className="text-xs muted">preview first</span>
            </button>
            <button className="btn-secondary h-24 flex-col gap-1.5" onClick={() => void beginRecording()} disabled={!supported}>
              <span className="text-2xl">🎙️</span>
              <span className="text-sm font-semibold">Record voice note</span>
              <span className="text-xs muted">pausable · up to 2 min</span>
            </button>
          </div>
        )}

        {/* ---------- RECORDING BAR with pause/resume ---------- */}
        {recording && (
          <div className={`rounded-xl border p-3 flex items-center gap-3 ${paused ? 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20' : 'border-rose-400/60 bg-rose-50 dark:bg-rose-950/20'}`}>
            <button
              className="btn-secondary btn-sm shrink-0"
              onClick={togglePause}
              aria-label={paused ? 'Resume recording' : 'Pause recording'}
            >
              <Icon name={paused ? 'play' : 'pause'} className="h-4 w-4" /> {paused ? 'Resume' : 'Pause'}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{paused ? 'Paused' : 'Recording…'} <span className="font-mono">{fmt(elapsed)}</span></p>
              <p className="text-xs muted">{paused ? 'Audio so far is kept — resume to continue the same note.' : 'Tap pause to take a breath; nothing is lost.'}</p>
            </div>
            <button className="btn-danger btn-sm shrink-0" onClick={() => void stopRec(true)}>Done</button>
            <button className="btn-ghost btn-sm text-rose-500 shrink-0" aria-label="Discard recording" onClick={() => void stopRec(false)}>✕</button>
          </div>
        )}

        {!supported && <p className="text-xs muted">Voice recording isn't supported in this browser — photo capture still works.</p>}

        {/* ---------- PREVIEWS ---------- */}
        {draft.photoData && !viewfinder && (
          <div className="relative">
            <img src={draft.photoData} alt="Idea photo" className="w-full max-h-64 object-contain rounded-xl border border-slate-900/10 dark:border-white/10" />
            <button className="btn-ghost btn-sm absolute top-2 right-2 bg-black/60 text-white" aria-label="Remove photo" onClick={() => setDraft((d) => ({ ...d, photoData: null }))}>✕</button>
          </div>
        )}

        {draft.voiceData && (
          <div className="flex items-center gap-2">
            <audio controls src={draft.voiceData} className="w-full h-10" />
            <button className="btn-ghost btn-sm text-rose-500" aria-label="Remove voice note" onClick={() => setDraft((d) => ({ ...d, voiceData: null, voiceDuration: null }))}>✕</button>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-secondary" onClick={onClose} disabled={recording}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()} disabled={recording || (!title.trim() && !draft.photoData && !draft.voiceData)}>
            Save idea {draft.photoData && draft.voiceData ? '📸🎙️' : draft.photoData ? '📸' : draft.voiceData ? '🎙️' : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
