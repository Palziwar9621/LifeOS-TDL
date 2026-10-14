// LifeOS desktop — preload: exposes the alarm bridge so the wrapped site can
// hand its upcoming alarms to the main process, which rings them natively
// (system notification + looping sound) even when the window is closed to
// the tray. Nothing else is privileged; the site works exactly as in a
// browser otherwise.
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('lifeos:alarm-dismissed', (_event, key) => {
  if (typeof key !== 'string' || !key) return;
  window.dispatchEvent(new CustomEvent('lifeos-native-alarm-dismiss', { detail: { key } }));
});

window.addEventListener('DOMContentLoaded', () => {
  document.title = 'LifeOS';
});

contextBridge.exposeInMainWorld('LifeOSNative', {
  platform: 'electron',
  alarms: {
    scheduleAlarms: (json) => ipcRenderer.invoke('lifeos:schedule-alarms', json),
  },
});
