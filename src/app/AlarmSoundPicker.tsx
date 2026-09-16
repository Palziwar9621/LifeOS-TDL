// LifeOS — shared alarm sound picker with preview
import React from 'react';
import { ALARM_SOUNDS, previewAlarmSound, type AlarmSoundId } from '../lib/alarm';

export function AlarmSoundPicker({ value, onChange, allowInherit = false }: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Show a "Use app default" option (for per-item editors). */
  allowInherit?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {allowInherit && (
        <button type="button"
          className={`btn-sm btn ${value === null ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onChange(null)}>
          Default
        </button>
      )}
      {ALARM_SOUNDS.filter((s) => s.id !== 'none').map((s) => (
        <button key={s.id} type="button"
          title={s.hint + ' — click to preview'}
          className={`btn-sm btn ${value === s.id ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { onChange(s.id); previewAlarmSound(s.id as AlarmSoundId); }}>
          🔔 {s.label}
        </button>
      ))}
    </div>
  );
}
