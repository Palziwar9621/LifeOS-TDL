import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../LifeOS/desktop/main.js', import.meta.url), 'utf8');
async function desktop(files = new Map<string, string>()) {
  let now = new Date('2026-10-10T08:00:00Z').getTime();
  let writeFails = false;
  const windows: any[] = [], notifications: any[] = [], polls: (() => void)[] = [];
  const handlers: Record<string, (...args: any[]) => any> = {};
  const app: any = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = async () => {};
  app.getPath = () => '/fake-user-data';
  app.quit = () => app.emit('before-quit');
  class Window extends EventEmitter {
    destroyed = false;
    hidden = false;
    url = '';
    webContents: any = new EventEmitter();
    options: any;
    constructor(options: any) {
      super(); this.options = options; windows.push(this);
      this.webContents.mainFrame = { url: 'https://life-os-tdl.vercel.app/app' };
      this.webContents.session = { clearStorageData: async () => {} };
      this.webContents.setWindowOpenHandler = () => {};
    }
    async loadURL(url: string) { this.url = url; }
    destroy() { this.destroyed = true; }
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    focus() { this.emit('focus'); }
    static getAllWindows() { return windows; }
  }
  class Notif extends EventEmitter {
    closed = false;
    options: any;
    constructor(options: any) { super(); this.options = options; notifications.push(this); }
    show() {}
    close() { this.closed = true; }
  }
  let tray: any;
  class Tray extends EventEmitter {
    menu: any;
    constructor() { super(); tray = this; }
    setToolTip() {}
    setContextMenu(menu: any) { this.menu = menu; }
  }
  const powerMonitor = new EventEmitter();
  let powerStarts = 0, powerStops = 0;
  const electron = { app, BrowserWindow: Window, Notification: Notif, Tray, powerMonitor,
    Menu: { buildFromTemplate: (menu: any) => menu }, nativeImage: { createEmpty: () => ({}) }, shell: { openExternal() {} },
    powerSaveBlocker: { start: () => { powerStarts++; return 1; }, stop: () => { powerStops++; } },
    ipcMain: { handle: (name: string, fn: any) => { handlers[name] = fn; } } };
  const fs = {
    existsSync: (p: string) => files.has(p), readFileSync: (p: string) => files.get(p),
    writeFileSync: (p: string, data: string) => { if (writeFails) throw new Error('disk full'); files.set(p, data); },
    renameSync: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
  };
  vm.runInNewContext(source, { require: (id: string) => id === 'electron' ? electron : id === 'fs' ? fs : path,
    __dirname: '/app', console, URL, process: { env: {}, platform: 'win32' },
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn: () => void) => { polls.push(fn); return polls.length; } });
  await new Promise(resolve => setImmediate(resolve));
  const send = (root: any, trusted = true) => handlers['lifeos:schedule-alarms']({ sender: trusted ? windows[0].webContents : {}, senderFrame: windows[0].webContents.mainFrame }, JSON.stringify(root));
  return { files, windows, notifications, tray, app, send, powerMonitor, polls,
    get now() { return now; }, advance: (ms: number) => { now += ms; }, failWrites: () => { writeFails = true; },
    get powerStarts() { return powerStarts; }, get powerStops() { return powerStops; } };
}
const alarm = (key: string, at: number) => ({ key, at, title: key, body: 'due' });

test('T4 tray keeps alarms alive; resume catches missed due time once using chosen sound', async () => {
  const h = await desktop();
  assert.equal(h.powerStarts, 1);
  assert.equal(h.send({ mode: 'alarm', sound: 'marimba', alarms: [alarm('task:t', h.now + 60000)] }).ok, true);
  let prevented = false;
  h.windows[0].emit('close', { preventDefault() { prevented = true; } });
  assert.ok(prevented && h.windows[0].hidden);
  h.advance(120000);
  h.powerMonitor.emit('resume');
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].options.silent, true);
  assert.match(decodeURIComponent(h.windows[1].url), /const sound = "marimba"/);
  h.polls[0]();
  assert.equal(h.notifications.length, 1);
  h.tray.menu.find((entry: any) => entry.label === 'Stop alarm').click();
  assert.ok(h.windows[1].destroyed);
  h.tray.menu.find((entry: any) => entry.label.startsWith('Quit LifeOS')).click();
  assert.equal(h.powerStops, 1);
});

test('T4 valid updates replace and cancel alarms, malformed/disk-failed/untrusted updates preserve them', async () => {
  const h = await desktop();
  const root = { mode: 'alarm', sound: 'chime', alarms: [alarm('old', h.now + 1000)] };
  h.send(root);
  assert.equal(h.send({ ...root, alarms: 'invalid' }).ok, false);
  assert.equal(h.send({ ...root, alarms: [] }, false).ok, false);
  h.send({ ...root, alarms: [alarm('new', h.now + 1000)] });
  h.failWrites();
  assert.equal(h.send({ ...root, alarms: [] }).ok, false);
  h.advance(1001); h.polls[0]();
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].options.title, 'new');
});

test('T4 offline restart restores persisted schedule; silent/off modes never create sound renderer', async () => {
  const first = await desktop();
  first.send({ mode: 'alarm', sound: 'none', alarms: [alarm('silent', first.now + 1000)] });
  const restored = await desktop(first.files);
  restored.advance(1001); restored.polls[0]();
  assert.equal(restored.notifications.length, 1);
  assert.equal(restored.windows.length, 1);
  const status = restored.send({ mode: 'off', sound: 'chime', alarms: [alarm('disabled', restored.now + 1000)] });
  assert.equal(status.scheduled, 0);
  assert.equal(status.next, 0);
  restored.advance(1001); restored.polls[0]();
  assert.equal(restored.notifications.length, 1);
});

test('T4 far-future alarm never fires early at the 32-bit timeout boundary; stale resume skips it', async () => {
  const h = await desktop();
  h.send({ mode: 'notify', sound: 'digital', alarms: [alarm('task:far', h.now + 40 * 86400000)] });
  h.advance(2 ** 31); h.polls[0]();
  assert.equal(h.notifications.length, 0);
  h.advance(41 * 86400000); h.powerMonitor.emit('resume');
  assert.equal(h.notifications.length, 0);
  assert.equal(h.windows.length, 1);
});
