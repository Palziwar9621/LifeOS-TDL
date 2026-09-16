// LifeOS — outbox: durable queue of unsynced local mutations.
// Mutations apply locally first (offline-first), get queued here, then flush.
import { idbGet, idbSet } from './idb';

export interface OutboxOp {
  id: string;
  seq: number;
  kind: 'insert' | 'update' | 'delete';
  table: string;
  row?: any;
  ref?: string;
  localRef?: string;
  patch?: any;
  attempts: number;
  lastError?: string;
  dead?: boolean;
  ts: number;
}

const OUTBOX_KEY = 'outbox';
const MAX_ATTEMPTS = 12;

export async function loadOutbox(): Promise<OutboxOp[]> {
  const ops = (await idbGet<OutboxOp[]>(OUTBOX_KEY)) ?? [];
  return ops.sort((a, b) => a.seq - b.seq);
}

export async function pushOp(
  partial: Omit<OutboxOp, 'id' | 'seq' | 'attempts' | 'ts'>,
  seq: number
): Promise<OutboxOp[]> {
  const ops = await loadOutbox();
  const op: OutboxOp = {
    ...partial,
    id: crypto.randomUUID(),
    seq,
    attempts: 0,
    ts: Date.now(),
  };
  ops.push(op);
  await save(ops);
  return ops;
}

export async function markFlushed(ids: Set<string>): Promise<OutboxOp[]> {
  const ops = await loadOutbox();
  const kept = ops.filter((o) => !ids.has(o.id));
  await save(kept);
  return kept;
}

export async function bumpAttempt(id: string, error: string): Promise<OutboxOp[]> {
  const ops = await loadOutbox();
  const op = ops.find((o) => o.id === id);
  if (op) {
    op.attempts = op.attempts + 1;
    op.lastError = error;
    if (op.attempts >= MAX_ATTEMPTS) op.dead = true;
  }
  await save(ops);
  return ops;
}

export async function dropOp(id: string): Promise<OutboxOp[]> {
  const ops = await loadOutbox();
  const idx = ops.findIndex((o) => o.id === id);
  if (idx >= 0) {
    ops.splice(idx, 1);
    await save(ops);
  }
  return ops;
}

export async function retryAllDead(): Promise<OutboxOp[]> {
  const ops = await loadOutbox();
  for (const o of ops) {
    o.dead = false;
    o.attempts = 0;
  }
  await save(ops);
  return ops;
}

export async function countPending(): Promise<number> {
  const ops = await loadOutbox();
  return ops.filter((o) => !o.dead).length;
}

async function save(ops: OutboxOp[]): Promise<void> {
  await idbSet(OUTBOX_KEY, ops);
}
