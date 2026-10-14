import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

test('T4 Android alarm notifications are swipeable and route delete through dismissal', () => {
  const receiver = readFileSync(new URL('LifeOS/android-build/app/src/main/java/app/lifeos/twa/AlarmReceiver.java', root), 'utf8');
  const service = readFileSync(new URL('LifeOS/android-build/app/src/main/java/app/lifeos/twa/AlarmSoundService.java', root), 'utf8');
  const bridge = readFileSync(new URL('LifeOS/android-build/app/src/main/java/app/lifeos/twa/AlarmBridge.java', root), 'utf8');
  assert.match(receiver, /\.setOngoing\(false\)/);
  assert.match(receiver, /\.setDeleteIntent\(pDismiss\)/);
  assert.match(receiver, /AlarmSoundService\.stop\(ctx, key, notifId\)/);
  assert.match(receiver, /AlarmBridge\.notifyWeb\(key, false\)/);
  assert.match(service, /sameAlarm\(key, notifId\)/);
  assert.match(service, /if \(activeKey == null\) stopSelfResult\(startId\)/);
  assert.match(service, /stopSelfResult\(startId\)/);
  const stopAlarm = bridge.slice(bridge.indexOf('public void stopAlarm'));
  assert.match(stopAlarm, /AlarmSoundService\.stop\(ctx, key,/);
  assert.doesNotMatch(stopAlarm, /AlarmSoundService\.stop\(ctx\);/);
});

test('T4 native dismissal stops only the matching visible WebAudio alarm', () => {
  const source = ts.transpileModule(
    readFileSync(new URL('../src/lib/alarm.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports: any = {};
  const listeners: Record<string, (event: Event) => void> = {};
  const nativeStops: string[] = [];
  const dismissed: string[] = [];
  vm.runInNewContext(source, {
    exports,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: { vibrate: () => true },
    window: {
      addEventListener: (name: string, callback: (event: Event) => void) => { listeners[name] = callback; },
      LifeOSNative: { stopAlarm: (key: string) => nativeStops.push(key) },
    },
    require: (name: string) => {
      if (name === './dismissals') return {
        isKeyDismissed: () => false,
        dismissKey: (key: string) => dismissed.push(key),
        syncDismissals: async () => {},
      };
      throw new Error(name);
    },
  });

  exports.startAlarm('new-occurrence', 'chime');
  listeners['lifeos-native-alarm-snooze']({ detail: { key: 'old-occurrence' } } as any);
  assert.equal(exports.getAlarmState().key, 'new-occurrence');
  listeners['lifeos-native-alarm-dismiss']({ detail: { key: 'old-occurrence' } } as any);
  assert.equal(exports.getAlarmState().key, 'new-occurrence');
  assert.deepEqual(nativeStops, ['old-occurrence']);
  assert.deepEqual(dismissed, ['old-occurrence']);

  listeners['lifeos-native-alarm-dismiss']({ detail: { key: 'new-occurrence' } } as any);
  assert.equal(exports.getAlarmState(), null);
  assert.deepEqual(nativeStops, ['old-occurrence', 'new-occurrence']);
  assert.deepEqual(dismissed, ['old-occurrence', 'new-occurrence']);
});

test('T4 service-worker swipe dismissal reaches open clients without treating replacement closes as swipes', () => {
  const source = readFileSync(new URL('../public/sw-custom.js', import.meta.url), 'utf8');
  assert.match(source, /self\.addEventListener\('notificationclose'/);
  assert.match(source, /type: 'lifeos-dismiss', key/);
  assert.match(source, /Notification\.close\(\)/);
  assert.match(source, /notificationclose/);
  assert.match(source, /for \(const c of cs\) c\.postMessage/);
});

test('T4 desktop notification close is identity-checked and forwarded to WebAudio', () => {
  const main = readFileSync(new URL('../LifeOS/desktop/main.js', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../LifeOS/desktop/preload.js', import.meta.url), 'utf8');
  assert.match(main, /const ringingAlarm = \{ key: alarm\.key, notif, closedByUs: false \}/);
  assert.match(main, /ringing !== ringingAlarm/);
  assert.match(main, /lifeos:alarm-dismissed/);
  assert.match(main, /ringing\.closedByUs = true/);
  assert.match(preload, /lifeos-native-alarm-dismiss/);
});
