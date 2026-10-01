// Regression tests for the deleted-task lifecycle:
// - queue a delete → op survives until flushed → row stays gone locally
// - parked (dead) delete ops must not resurrect rows
// - outbox ops replay idempotently (same op id, flush clears exactly once)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemIdb, resetMemIdb } from './mem-idb.ts';

beforeEach(() => {
  resetMemIdb();
  installMemIdb();
  // fresh module state per test (outbox.ts caches nothing; idb is our state)
});

async function freshOutbox() {
  return await import('../src/lib/outbox.ts');
}

test('delete op queued then flushed disappears exactly once', async () => {
  const ob = await freshOutbox();
  await ob.pushOp({ kind: 'delete', table: 'tasks', ref: 'task-1' }, 1);
  await ob.pushOp({ kind: 'insert', table: 'tasks', ref: 'task-2', row: { id: 'task-2' } }, 2);

  let ops = await ob.loadOutbox();
  assert.equal(ops.length, 2);
  assert.equal(ops[0].kind, 'delete');
  assert.equal(ops[0].ref, 'task-1');

  ops = await ob.markFlushed(new Set([ops[0].id]));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, 'insert');

  // flushing the remaining op with the same id set empties the queue (idempotent)
  const firstId = (await ob.loadOutbox())[0];
  ops = await ob.markFlushed(new Set([firstId.id]));
  assert.equal(ops.length, 0);
});

test('parked delete op keeps its identity for tombstone checks', async () => {
  const ob = await freshOutbox();
  await ob.pushOp({ kind: 'delete', table: 'tasks', ref: 'task-1' }, 1);
  for (let i = 0; i < 12; i++) await ob.bumpAttempt((await ob.loadOutbox())[0].id, 'rls denied');
  let ops = await ob.loadOutbox();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].dead, true); // parked, NOT dropped: row must stay deleted
  assert.equal(ops[0].ref, 'task-1');
  ops = await ob.retryAllDead();
  assert.equal(ops[0].dead, false); // retry re-arms the same delete
});

test('countPending ignores dead ops but keeps them in the queue', async () => {
  const ob = await freshOutbox();
  await ob.pushOp({ kind: 'delete', table: 'tasks', ref: 'a' }, 1);
  await ob.pushOp({ kind: 'insert', table: 'tasks', ref: 'b', row: { id: 'b' } }, 2);
  const ops = await ob.loadOutbox();
  await ob.bumpAttempt(ops[0].id, 'x');
  await ob.bumpAttempt(ops[0].id, 'x');
  for (let i = 2; i < 12; i++) await ob.bumpAttempt(ops[0].id, 'x');
  assert.equal(await ob.countPending(), 1);
  assert.equal((await ob.loadOutbox()).length, 2); // dead op still present
});
