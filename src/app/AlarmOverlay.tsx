// LifeOS — full-screen in-app alarm overlay.
// Shows while an alarm is ringing: big title, pulsing icon, and the two
// controls that matter at 6 am — "Turn off" and "Snooze 10 min".
import React, { useEffect, useState } from 'react';
import { getAlarmState, subscribeAlarm, stopAlarm, snoozeAlarm } from '../lib/alarm';

export function AlarmOverlay() {
  const [alarm, setAlarm] = useState(getAlarmState());
  useEffect(() => subscribeAlarm(() => setAlarm(getAlarmState())), []);

  if (!alarm) return null;
  const isRoutine = alarm.key.startsWith('routine:');
  const isTask = alarm.key.startsWith('task:');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-20 w-20 animate-bounce items-center justify-center rounded-full bg-rose-500 text-white shadow-lg">
          <span className="text-4xl">⏰</span>
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-rose-500">
          {isRoutine ? 'Routine time' : isTask ? 'Task due soon' : 'Reminder'}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{alarm.title.replace(/^⏰\s*/, '')}</h2>
        {alarm.body && <p className="mt-1 text-sm muted">{alarm.body}</p>}
        <p className="mt-2 text-xs muted font-semibold">Ringing until you turn it off…</p>
        <div className="mt-6 grid gap-2">
          <button
            className="btn-primary !py-3 text-base"
            onClick={() => stopAlarm()}
            autoFocus
          >
            ⏹ Turn off
          </button>
          <button
            className="btn-secondary !py-3"
            onClick={() => snoozeAlarm(10)}
          >
            😴 Snooze 10 min
          </button>
        </div>
      </div>
    </div>
  );
}
