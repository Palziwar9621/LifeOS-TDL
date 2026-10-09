// Plans are generated remotely; validation and all data actions run locally.
import { getClient } from './supabase';
import { validateToolCall, type ToolCall } from '../../supabase/functions/assistant/contract';
import { AssistantError, assistantError, assistantErrorCode } from './assistantError';
export { AssistantError } from './assistantError';
export type { AssistantErrorCode } from './assistantError';
export { TOOLS, SYSTEM_PROMPT, CAPABILITIES, UNSUPPORTED_CONTROLS } from '../../supabase/functions/assistant/contract';
export type { ToolCall };

export interface AppContext {
  page: string;
  pageParams: Record<string, string>;
  today: string;
  weekday: string;
  time: string;
  timezoneOffsetMinutes?: number;
  projects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  recentTaskTitles: string[];
  todayTaskCount: number;
  routines: string[];
}

export async function askBrain(spoken: string, ctx: AppContext, history: { role: 'user' | 'assistant'; content: string }[] = [], signal?: AbortSignal): Promise<{ reply: string; calls: ToolCall[] }> {
  if (signal?.aborted) throw new AssistantError('cancelled');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 25_000);
  // Auth SDK calls do not accept AbortSignal. Race them too so a hung refresh
  // cannot keep voice interaction pending or continue into a late invocation.
  async function bounded<T>(promise: PromiseLike<T>, auth = false): Promise<T> {
    if (controller.signal.aborted) throw new AssistantError(signal?.aborted ? 'cancelled' : 'network');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop!: () => void;
    try {
      return await Promise.race([Promise.resolve(promise), new Promise<never>((_, reject) => {
        stop = () => reject(new AssistantError(signal?.aborted ? 'cancelled' : 'network'));
        controller.signal.addEventListener('abort', stop, { once: true });
        if (auth) timer = setTimeout(stop, 5_000);
      })]);
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', stop); }
  }
  try {
    const sb = getClient();
    if (!sb) throw new AssistantError('unconfigured', true);
    const initial = await bounded(sb.auth.getSession(), true);
    if (initial.error) throw new AssistantError(initial.error.status === 0 || (initial.error.status ?? 0) >= 500 ? 'network' : 'auth_expired');
    let session = initial.data.session;
    if (!session?.access_token || !session.user?.id) throw new AssistantError('guest', true);
    let refreshed = false;
    const refresh = async () => {
      refreshed = true;
      const result = await bounded(sb.auth.refreshSession(), true);
      if (result.error) throw new AssistantError(result.error.status === 0 || (result.error.status ?? 0) >= 500 ? 'network' : 'auth_expired');
      if (!result.data.session?.access_token || !result.data.session.user?.id) throw new AssistantError('auth_expired');
      session = result.data.session;
    };
    if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) await refresh();
    for (let attempt = 0; attempt < 2; attempt++) {
      controller.signal.throwIfAborted();
      const { data, error } = await bounded(sb.functions.invoke('assistant', {
        headers: { Authorization: `Bearer ${session!.access_token}` },
        body: { spoken, ctx, history: history.slice(-8).map(h => ({ role: h.role, content: h.content.slice(0, 300) })) },
        signal: controller.signal,
      }));
      controller.signal.throwIfAborted();
      const response = error?.context instanceof Response ? error.context : undefined;
      let code = assistantErrorCode(data?.code);
      if (response) {
        try { code = assistantErrorCode((await bounded<any>(response.clone().json()))?.code) ?? code; } catch { /* no untrusted error prose */ }
      }
      const status = response?.status;
      if ((status === 401 || code === 'auth_expired') && !refreshed) { await refresh(); continue; }
      if (error || data?.error || code) {
        if (error instanceof SyntaxError) throw new AssistantError('invalid_contract');
        throw new AssistantError(code ?? (status === 401 || status === 403 ? 'auth_expired' : status === 429 ? 'rate_limit' : status === 404 ? 'unconfigured' : status ? 'unavailable' : 'network'));
      }
      if (!data || !Array.isArray(data.calls) || data.calls.length > 6 || typeof data.reply !== 'string' || (!data.calls.length && !data.reply.trim())) throw new AssistantError('invalid_contract');
      try { return { reply: data.reply.slice(0, 1000), calls: data.calls.map(validateToolCall) }; }
      catch { throw new AssistantError('invalid_contract'); }
    }
    throw new AssistantError('auth_expired');
  } catch (error) {
    if (controller.signal.aborted) throw new AssistantError(signal?.aborted ? 'cancelled' : 'network');
    throw assistantError(error);
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
