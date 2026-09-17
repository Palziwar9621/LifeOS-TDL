// LifeOS desktop — Electron wrapper around the LifeOS PWA.
// Loads the deployed site so everything (sync, alarms, notifications)
// behaves exactly like the browser, but as a standalone app with its own
// window. Alarms keep working while the window is closed to the tray —
// and now ring natively (main-process timers + sound) even then.
const { app, BrowserWindow, Notification, shell, powerSaveBlocker, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');

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
// here via preload IPC. Each becomes a main-process timer; when one
// fires we show a system notification and loop a beep + title flash
// until the user opens the app or 3 minutes pass. Timers in the main
// process are not throttled like background web pages.
// ------------------------------------------------------------------
let scheduled = new Map(); // key -> { timer, at, title, body }
let ringing = null;        // { interval, deadline, notif }

function ringNow(alarm) {
  stopRinging();
  const deadline = Date.now() + 3 * 60 * 1000; // same 3-min cap as the web app
  const notif = new Notification({
    title: alarm.title || '⏰ LifeOS alarm',
    body: alarm.body || 'Time is up — open LifeOS.',
    icon: path.join(__dirname, 'icon.png'),
    urgency: 'critical',
    timeoutType: 'never',
    actions: [],
  });
  notif.on('click', () => {
    stopRinging();
    if (win) { win.show(); win.focus(); } else createWindow();
  });
  notif.show();

  // Looping beep (main-process speaker beep) + tray attention.
  const beep = () => {
    try { process.stderr.write('\x07'); } catch { /* ignore */ }
    if (tray) tray.setToolTip('⏰ LifeOS — ALARM: ' + (alarm.title || ''));
  };
  beep();
  const interval = setInterval(beep, 3000);
  ringing = { interval, deadline, notif };
  const cap = setInterval(() => { if (Date.now() > deadline) { stopRinging(); clearInterval(cap); } }, 1000);
}

function stopRinging() {
  if (ringing) { clearInterval(ringing.interval); ringing = null; if (tray) tray.setToolTip('LifeOS — alarms stay active'); }
}

ipcMain.on('lifeos:schedule-alarms', (_e, json) => {
  try {
    const root = JSON.parse(json);
    // Clear previous timers.
    for (const { timer } of scheduled.values()) clearTimeout(timer);
    scheduled.clear();

    const now = Date.now();
    for (const a of root.alarms || []) {
      if (!a.key || !a.at || a.at <= now) continue;
      const delay = Math.min(a.at - now, 2 ** 31 - 1);
      const timer = setTimeout(() => {
        scheduled.delete(a.key);
        ringNow(a);
      }, delay);
      scheduled.set(a.key, { timer, at: a.at, title: a.title, body: a.body });
    }
  } catch (err) {
    console.warn('schedule-alarms failed:', err.message);
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
    },
  });

  // The wrapper always wants the LATEST deployed site: clear the PWA
  // service-worker cache on startup so a Vercel redeploy is picked up
  // immediately instead of serving a stale bundle forever.
  win.webContents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
    .catch((err) => console.warn('cache clear failed:', err.message))
    .then(() => win.loadURL(APP_URL));

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
}

function startPowerSave() {
  // Guarded: on some Electron builds/Windows combos this API can be missing.
  // It must NEVER take down startup — window + tray come first.
  try {
    if (powerSaveBlocker && typeof powerSaveBlocker.startPowerSaveBlocker === 'function' && powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.startPowerSaveBlocker('prevent-app-suspension');
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
  tray.setToolTip('LifeOS — alarms stay active');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open LifeOS', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
}

app.whenReady().then(() => {
  createTray();
  createWindow();
  startPowerSave();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) win.show();
  });
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // Stay alive in tray (alarms!). Quit only via tray → Quit.
  if (process.platform !== 'darwin' && quitting) app.quit();
});
