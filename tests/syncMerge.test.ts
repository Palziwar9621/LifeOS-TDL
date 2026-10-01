// Regression test for the "deleted task keeps coming back" bug:
// a task deleted locally must stay deleted after a pull, even when its
// delete op is parked/dead — and realtime inserts must not resurrect it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePulledRows } from '../src/lib/syncMerge.ts';

type R = { id: string; updated_at: string };

const aliveDelete = {
  hasPendingOp: (_t: string, id: string) => id === 't2', // t2 has a live update
  hasQueuedDelete: (_t: string, id: string) => id === 't1',
};
const parkedDelete = {
  hasPendingOp: () => false, // dead ops are not "pending"
  hasQueuedDelete: (_t: string, id: string) => id === 't1', // tombstone survives parking
};

test('deleted task with a queued delete op does not resurrect from pull', () => {
  const local: R[] = [];
  const remote: R[] = [{ id: 't1', updated_at: '2026-10-01T10:00:00Z' }];
  const merged = mergePulledRows('tasks', local, remote, aliveDelete);
  assert.deepEqual(merged, []); // stays deleted
});

test('deleted task stays deleted even when the delete op is PARKED', () => {
  const local: R[] = [];
  const remote: R[] = [{ id: 't1', updated_at: '2026-10-01T10:00:00Z' }];
  const merged = mergePulledRows('tasks', local, remote, parkedDelete);
  assert.deepEqual(merged, []);
});

test('realtime-style re-add of a tombstoned row is ignored', () => {
  // mergeRemoteRow path: local list without the row, remote row present
  const local: R[] = [];
  const remote: R[] = [{ id: 't1', updated_at: '2026-10-01T09:00:00Z' }];
  const merged = mergePulledRows('tasks', local, remote, parkedDelete);
  assert.equal(merged.some((r) => r.id === 't1'), false);
});

test('local pending edit wins over the remote copy', () => {
  const local: R[] = [{ id: 't2', updated_at: '2026-10-01T12:00:00Z' }];
  const remote: R[] = [{ id: 't2', updated_at: '2026-10-01T13:00:00Z' }];
  const merged = mergePulledRows('tasks', local, remote, aliveDelete);
  assert.equal(merged[0].updated_at, '2026-10-01T12:00:00Z');
});

test('last-write-wins when nothing is pending', () => {
  const local: R[] = [{ id: 't3', updated_at: '2026-10-01T08:00:00Z' }];
  const remote: R[] = [{ id: 't3', updated_at: '2026-10-01T09:00:00Z' }];
  const merged = mergePulledRows('tasks', local, remote, parkedDelete);
  assert.equal(merged[0].updated_at, '2026-10-01T09:00:00Z');
});

test('unsynced local insert survives the pull; abandoned local rows do not', () => {
  const local: R[] = [
    { id: 'new', updated_at: '2026-10-01T12:00:00Z' }, // pending insert
    { id: 'stale', updated_at: '2026-10-01T12:00:00Z' }, // no op, gone server-side
  ];
  const q = {
    hasPendingOp: (_t: string, id: string) => id === 'new',
    hasQueuedDelete: () => false,
  };
  const merged = mergePulledRows('tasks', local, [], q);
  assert.deepEqual(merged.map((r) => r.id), ['new']);
});

test('brand-new server rows are added', () => {
  const merged = mergePulledRows<R>('tasks', [], [{ id: 'srv', updated_at: '2026-10-01T09:00:00Z' }], parkedDelete);
  assert.deepEqual(merged.map((r) => r.id), ['srv']);
});
