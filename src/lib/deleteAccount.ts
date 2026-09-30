// LifeOS — account deletion client.
// Calls the `delete-account` Edge Function with the user's own access token.
// The server derives the user ID from that token — nothing here is trusted
// as authorization. Local cleanup happens only AFTER the server confirms.
import { getClient } from './supabase';
import { getSession } from './auth';
import { idbWipeUser, idbDel } from './idb';

export type DeletePhase =
  | 'idle' | 'confirming' | 'deleting-server' | 'cleaning-local' | 'done' | 'error';

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

/** Calls the edge function; resolves only when the server confirms deletion. */
export async function deleteAccountRemote(): Promise<DeleteResult> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Not connected to a backend.' };
  const session = await getSession();
  if (!session?.access_token) return { ok: false, error: 'Not signed in.' };

  try {
    const res = await fetch(`${(sb as any).supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: (sb as any).supabaseKey ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: String(data?.error ?? `Server error ${res.status}`) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error during account deletion.' };
  }
}

/**
 * Wipes every local trace of the account: IndexedDB cache (all keys with the
 * user prefix), the outbox, assistant settings and cached Supabase config.
 * Called only after the server has confirmed deletion.
 */
export async function purgeLocalData(userId: string): Promise<void> {
  try {
    await idbWipeUser(userId + ':');
    await idbDel('outbox');
    localStorage.removeItem('lifeos.assistant');
    localStorage.removeItem('lifeos.theme');
    localStorage.removeItem('lifeos.premiumTheme');
    localStorage.removeItem('lifeos.supabase');
    sessionStorage.clear();
  } catch {
    // best-effort — the server-side deletion is the source of truth
  }
}
