// LifeOS — instant idea capture: snap a photo + record a voice note in one flow.
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from '../ui/components';
import { useApp } from './store';
import { createIdea } from '../lib/db';
import { capturePhoto, pickPhotoFile, startVoiceRecording, isCaptureSupported, type VoiceSession } from '../lib/media';

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
  const [snapping, setSnapping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  const timerRef = useRef<number | null>(null);

  // Reset each time the modal opens.
  useEffect(() => {
    if (open) {
      setTitle('');
      setDraft({ photoData: null, voiceData: null, voiceDuration: null });
    }
  }, [open]);

  useEffect(() => () => {
    sessionRef.current?.cancel();
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const supported = isCaptureSupported();

  const snap = async () => {
    setSnapping(true);
    try {
      const photo = await capturePhoto();
      setDraft((d) => ({ ...d, photoData: photo.dataUrl }));
    } catch (e: any) {
      // Camera blocked/unavailable → graceful fallback to file picker.
      const picked = await pickPhotoFile();
      if (picked) setDraft((d) => ({ ...d, photoData: picked.dataUrl }));
      else toast(e?.message ?? 'Could not take the photo', 'error');
    } finally {
      setSnapping(false);
    }
  };

  const startRec = async () => {
    try {
      const session = await startVoiceRecording();
      sessionRef.current = session;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(session.elapsedSecs()), 250);
    } catch (e: any) {
      toast(e?.message ?? 'Could not start recording', 'error');
    }
  };

  const stopRec = async (keep: boolean) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    if (!session) return;
    if (!keep) { session.cancel(); return; }
    try {
      const rec = await session.stop();
      if (rec.durationSecs < 1) { toast('Recording too short — hold a little longer', 'error'); return; }
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

  const requestClose = () => { if (!recording) onClose(); };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <Modal open={open} onClose={requestClose} title="Capture an idea" wide>
      <p className="text-sm muted mb-3">Saw something that sparked an idea? Snap it, talk about it — it lands in Ideas &amp; Future instantly.</p>
      <div className="space-y-4">
        <div>
          <label className="label">Title <span className="muted font-normal">(optional — a photo or voice note alone works)</span></label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mural idea for the stairwell" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secondary h-24 flex-col gap-1.5" onClick={() => void snap()} disabled={snapping || recording}>
            {snapping ? <span className="text-sm">Opening camera…</span> : (
              <>
                <Icon name="plus" className="h-6 w-6" />
                <span className="text-sm font-semibold">{draft.photoData ? 'Retake photo' : 'Take a photo'}</span>
                <span className="text-xs muted">camera</span>
              </>
            )}
          </button>
          {!recording ? (
            <button className="btn-secondary h-24 flex-col gap-1.5" onClick={() => void startRec()} disabled={!supported || snapping}>
              <Icon name="bell" className="h-6 w-6" />
              <span className="text-sm font-semibold">{draft.voiceData ? 'Re-record voice' : 'Record voice note'}</span>
              <span className="text-xs muted">{draft.voiceData ? `saved · ${fmt(draft.voiceDuration ?? 0)}` : 'up to 2 min'}</span>
            </button>
          ) : (
            <button className="btn-danger h-24 flex-col gap-1.5 animate-pulse" onClick={() => void stopRec(true)}>
              <span className="text-xl">⏹</span>
              <span className="text-sm font-semibold">Stop · {fmt(elapsed)}</span>
              <span className="text-xs opacity-80">recording…</span>
            </button>
          )}
        </div>

        {!supported && <p className="text-xs muted">Voice recording isn't supported in this browser — photo capture still works.</p>}

        {draft.photoData && (
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
          <button className="btn-primary" onClick={() => void save()} disabled={recording}>
            Save idea {draft.photoData && draft.voiceData ? '📸🎙️' : draft.photoData ? '📸' : draft.voiceData ? '🎙️' : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
