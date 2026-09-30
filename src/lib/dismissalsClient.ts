// Small indirection so dismissals.ts can be imported by both the store boot
// path and the schedulers without circular imports (supabase.ts has no
// imports; db.ts pulls in a lot).
import { getClient } from './supabase';
import { currentUserId } from './db';
import { isGuest } from './guest';

export function getClientSafe() { return isGuest() ? null : getClient(); }
export function currentUserIdSafe() { return currentUserId(); }
