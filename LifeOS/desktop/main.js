// LifeOS desktop — Electron wrapper around the LifeOS PWA.
// Loads the deployed site so everything (sync, alarms, notifications)
// behaves exactly like the browser, but as a standalone app with its own
// window. Alarms keep working while the window is closed to the tray —
// and now ring natively (main-process timers + sound) even then.
const { app, BrowserWindow, Notification, shell, powerMonitor, powerSaveBlocker, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = process.env.LIFEOS_URL || 'https://life-os-tdl.vercel.app';

let win = null;
let tray = null;
let quitting = false;
// Keep timers/alarms reliable while backgrounded (prevents OS throttling).
let powerSaveBlockerId = null;

// Single instance: double-clicking the exe again focuses the running app
// instead of spawning a silent second process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
}

// ------------------------------------------------------------------
// Native alarms: the site (nativeAlarms.ts) sends its upcoming alarms
// here via acknowledged IPC. The disk snapshot survives restarts; polling
// and resume reconciliation handle sleep and clock changes. A fully quit
// process cannot ring or wake Windows; close-to-tray keeps it running.
// ------------------------------------------------------------------
let scheduled = new Map();
let alarmMode = 'notify';
let alarmSound = 'chime';
let ringing = null;
let soundWindow = null;
const sounds = new Set(['chime', 'birdsong', 'pulse', 'marimba', 'sunrise', 'digital', 'none']);
const alarmFile = () => path.join(app.getPath('userData'), 'native-alarms.json');

function persistAlarms(alarms = [...scheduled.values()], mode = alarmMode, sound = alarmSound) {
  const file = alarmFile();
  fs.writeFileSync(file + '.tmp', JSON.stringify({ alarms, mode, sound }), 'utf8');
  fs.renameSync(file + '.tmp', file);
}

function alarmTime(a) {
  return a.localAt ? new Date(a.localAt).getTime() - (a.leadMinutes || 0) * 60000 : a.at;
}

function validateSchedule(root) {
  if (!root || !Array.isArray(root.alarms) || !['off', 'notify', 'alarm'].includes(root.mode)) throw new Error('Invalid alarm schedule');
  if (!sounds.has(root.sound)) throw new Error('Invalid alarm sound');
  const keys = new Set();
  for (const a of root.alarms) {
    if (!a || typeof a.key !== 'string' || !a.key || keys.has(a.key) || !Number.isFinite(a.at) || !Number.isFinite(alarmTime(a))) throw new Error('Invalid alarm');
    keys.add(a.key);
  }
  return root;
}

function replaceSchedule(root, persist = true) {
  validateSchedule(root);
  const alarms = root.mode === 'off' ? [] : root.alarms;
  // Disk write must succeed before dropping the live schedule.
  if (persist) persistAlarms(alarms, root.mode, root.sound);
  scheduled = new Map(alarms.map(a => [a.key, a]));
  alarmMode = root.mode;
  alarmSound = root.sound;
  if (alarmMode !== 'alarm' || alarmSound === 'none') stopRinging();
}

function reconcileAlarms() {
  const now = Date.now();
  const due = [...scheduled.values()].filter(a => alarmTime(a) <= now);
  if (!due.length) return;
  for (const a of due) scheduled.delete(a.key);
  try { persistAlarms(); } catch (err) { console.warn('alarm persistence failed:', err.message); }
  for (const a of due) {
    const grace = a.key.startsWith('routine:') ? 2 * 3600000 : 12 * 3600000;
    if (now - alarmTime(a) <= grace && alarmMode !== 'off') ringNow(a);
  }
}

// Dedicated local renderer plays the same melodies even with the website
// offline/hidden. Terminal BEL (stderr) is inaudible in packaged Windows apps.
function playNativeSound(sound) {
  if (sound === 'none') return;
  soundWindow = new BrowserWindow({ show: false, width: 1, height: 1,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  const script = `
    const c = new AudioContext();
    const sound = ${JSON.stringify(sound)};
    const notes = {
      chime: [[880,0,.6,.3],[1320,.12,.5,.2],[1760,.24,.4,.12]],
      birdsong: [[2200,0,.1,.22],[2800,.12,.08,.18],[2400,.30,.1,.22],[3100,.42,.08,.15]],
      marimba: [[523,0,.25,.32],[659,.18,.25,.26],[784,.36,.35,.22]],
      sunrise: [[392,0,.5,.18],[494,.14,.5,.18],[587,.28,.5,.18],[784,.42,.5,.18]],
      pulse: [[940,0,.09,.36],[940,.18,.09,.36]],
      digital: [[1000,0,.07,.34],[1000,.12,.07,.34],[1000,.24,.07,.34]]
    };
    const type = { marimba:'triangle', pulse:'square', digital:'sawtooth' }[sound] || 'sine';
    function play() {
      c.resume();
      for (const [freq,at,dur,volume] of notes[sound] || notes.chime) {
        for (const [multiple,gain,wave] of [[1,1,type],[2,.5,type],[.5,.35,'sawtooth']]) {
          const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at + .02;
          o.type = wave; o.frequency.value = freq * multiple;
          g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(volume*gain*2.2,t+.015);
          g.gain.exponentialRampToValueAtTime(.0001,t+dur);
          o.connect(g).connect(c.destination); o.start(t); o.stop(t+dur+.05);
        }
      }
    }
    play(); setInterval(play,1200);
  `;
  soundWindow.loadURL('data:text/html,' + encodeURIComponent('<script>' + script + '</script>'));
}

function ringNow(alarm) {
  stopRinging();
  const notif = new Notification({
    title: alarm.title || '⏰ LifeOS alarm',
    body: alarm.body || 'Time is up — open LifeOS.',
    icon: path.join(__dirname, 'icon.png'),
    urgency: 'critical',
    timeoutType: 'never',
    actions: [],
    silent: true, // selected melody below; no extra system notification beep
  });
  notif.on('click', () => {
    stopRinging();
    if (win) { win.show(); win.focus(); } else createWindow();
  });
  notif.show();

  ringing = { notif };
  if (alarmMode === 'alarm' && alarmSound !== 'none') playNativeSound(alarmSound);
  if (tray) tray.setToolTip('⏰ LifeOS — ALARM: ' + (alarm.title || ''));
}

function stopRinging() {
  if (soundWindow) { soundWindow.destroy(); soundWindow = null; }
  if (ringing) { ringing.notif.close(); ringing = null; }
  if (tray) tray.setToolTip('LifeOS — alarms active while running');
}

ipcMain.handle('lifeos:schedule-alarms', (e, json) => {
  try {
    if (!win || e.sender !== win.webContents || e.senderFrame !== e.sender.mainFrame
        || new URL(e.senderFrame.url).origin !== new URL(APP_URL).origin) throw new Error('Untrusted alarm sender');
    replaceSchedule(JSON.parse(json));
    reconcileAlarms();
    return { ok: true, scheduled: scheduled.size, next: scheduled.size ? Math.min(...[...scheduled.values()].map(alarmTime)) : 0, background: 'tray-only' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });

  // The wrapper always wants the LATEST deployed site: clear the PWA
  // service-worker cache on startup so a Vercel redeploy is picked up
  // immediately instead of serving a stale bundle forever.
  win.webContents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
    .catch((err) => console.warn('cache clear failed:', err.message))
    // /app is the product itself; "/" is now the public marketing site.
    .then(() => win.loadURL(APP_URL + '/app'));

  // If the site fails to load (offline/DNS), show something instead of a
  // blank window so the app never looks like it "didn't open".
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain) {
      win.loadURL('data:text/html,' + encodeURIComponent(
        `<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>⏳ LifeOS</h1><p>Could not reach the server (${desc}).</p><p>Check your internet connection and restart the app.</p></div></body>`
      ));
    }
  });

  // Open external links (e.g. Supabase dashboard) in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Stop any ringing alarm once the user opens the app.
  win.on('focus', stopRinging);

  // Close-to-tray so alarms/notifications keep firing after "X".
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function startPowerSave() {
  // Guarded: on some Electron builds/Windows combos this API can be missing.
  // It must NEVER take down startup — window + tray come first.
  try {
    if (powerSaveBlocker && typeof powerSaveBlocker.start === 'function' && powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } catch (err) {
    console.warn('powerSaveBlocker unavailable:', err.message);
  }
}

function createTray() {
  // Minimal 16x16 transparent-ish PNG is fine; Electron ships a default when missing.
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip('LifeOS — alarms active while running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open LifeOS', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
    { label: 'Stop alarm', click: stopRinging },
    { label: 'Quit LifeOS (stops alarms)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
}

if (gotLock) app.whenReady().then(() => {
  createTray();
  createWindow();
  startPowerSave();
  try {
    if (fs.existsSync(alarmFile())) replaceSchedule(JSON.parse(fs.readFileSync(alarmFile(), 'utf8')), false);
  } catch (err) { console.warn('alarm restore failed:', err.message); }
  reconcileAlarms();
  setInterval(reconcileAlarms, 1000);
  powerMonitor.on('resume', reconcileAlarms);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) win.show();
  });
});

app.on('before-quit', () => {
  quitting = true;
  stopRinging();
  if (powerSaveBlockerId !== null) powerSaveBlocker.stop(powerSaveBlockerId);
});

app.on('window-all-closed', () => {
  // Stay alive in tray (alarms!). Quit only via tray → Quit.
  if (process.platform !== 'darwin' && quitting) app.quit();
});
