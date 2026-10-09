import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearTutorialProgress, readTutorialProgress, saveTutorialProgress } from '../src/app/tutorialState.ts';
import { parseQuickAdd } from '../src/lib/quickadd.ts';

function storageFixture() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

test('T1: a new account gets a tour regardless of another account or the legacy global flag', () => {
  const storage = storageFixture();
  storage.setItem('lifeos.tutorial.done', '1');
  saveTutorialProgress('established-account', { status: 'completed', step: 14 }, storage);
  assert.equal(readTutorialProgress('brand-new-account', 15, storage), null);
  assert.deepEqual(readTutorialProgress('established-account', 15, storage), { status: 'completed', step: 14 });
});

test('T1: progress survives a new read from device storage, without marking activities complete', () => {
  const storage = storageFixture();
  storage.setItem('lifeos.tutorial.v2:returning-account', JSON.stringify({ status: 'active', step: 5 }));
  assert.deepEqual(readTutorialProgress('returning-account', 15, storage), { status: 'active', step: 5 });
  assert.equal(storage.entries.size, 1, 'reading the tour must not write user data');
});

test('T1: skipping remains distinct from finishing and each persists across login reads', () => {
  const storage = storageFixture();
  saveTutorialProgress('skip-account', { status: 'skipped', step: 2 }, storage);
  saveTutorialProgress('finish-account', { status: 'completed', step: 14 }, storage);
  assert.equal(readTutorialProgress('skip-account', 15, storage)?.status, 'skipped');
  assert.equal(readTutorialProgress('finish-account', 15, storage)?.status, 'completed');
  assert.deepEqual(JSON.parse(storage.getItem('lifeos.tutorial.v2:skip-account')!), { status: 'skipped', step: 2 });
  assert.deepEqual(JSON.parse(storage.getItem('lifeos.tutorial.v2:finish-account')!), { status: 'completed', step: 14 });
});

test('T1: restart clears only the current account tour', () => {
  const storage = storageFixture();
  saveTutorialProgress('restart-account', { status: 'skipped', step: 7 }, storage);
  saveTutorialProgress('other-account', { status: 'completed', step: 14 }, storage);
  storage.setItem('lifeos.tasks', 'existing user data');
  clearTutorialProgress('restart-account', storage);
  assert.equal(readTutorialProgress('restart-account', 15, storage), null);
  assert.equal(readTutorialProgress('other-account', 15, storage)?.status, 'completed');
  assert.equal(storage.getItem('lifeos.tasks'), 'existing user data');
});

test('T1: corrupt or obsolete stored steps cannot crash or incorrectly finish the tour', () => {
  const storage = storageFixture();
  const invalid = ['{', 'null', '[]', '{"status":"completed","step":-1}', '{"status":"active","step":999}', '{"status":"active","step":1.5}', '{"status":"invented","step":0}'];
  invalid.forEach((raw, i) => {
    storage.setItem(`lifeos.tutorial.v2:corrupt-${i}`, raw);
    assert.equal(readTutorialProgress(`corrupt-${i}`, 15, storage), null);
  });
});

test('T1: blocked storage keeps progress for this app session instead of throwing', () => {
  const blocked = {
    getItem: (_key: string): string | null => { throw new Error('blocked'); },
    setItem: (_key: string, _value: string) => { throw new Error('blocked'); },
    removeItem: (_key: string) => { throw new Error('blocked'); },
  };
  assert.equal(readTutorialProgress('blocked-account', 15, blocked), null);
  saveTutorialProgress('blocked-account', { status: 'skipped', step: 3 }, blocked);
  assert.deepEqual(readTutorialProgress('blocked-account', 15, blocked), { status: 'skipped', step: 3 });
  clearTutorialProgress('blocked-account', blocked);
  assert.equal(readTutorialProgress('blocked-account', 15, blocked), null);
});

test('T1: preview exercise uses the real parser, including blank input', () => {
  const parsed = parseQuickAdd('Read tomorrow at 7pm !high #learning', '2026-10-10');
  assert.equal(parsed.title, 'Read');
  assert.equal(parsed.due_date, '2026-10-11');
  assert.equal(parsed.due_time, '19:00:00');
  assert.equal(parsed.priority, 'high');
  assert.deepEqual(parsed.tags, ['learning']);
  assert.equal(parseQuickAdd('', '2026-10-10').title, '');
});
