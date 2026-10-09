// Plans are generated remotely; validation and all data actions run locally.
import { getClient } from './supabase';
import { currentUserId } from './db';
import { type ToolCall } from '../../supabase/functions/assistant/contract';
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
  signal?.throwIfAborted();
  const sb = getClient();
  if (!sb || !currentUserId()) throw new Error('Not signed in');
  const { data, error } = await sb.functions.invoke('assistant', {
    body: { spoken, ctx, history: history.slice(-8).map(h => ({ role: h.role, content: h.content.slice(0, 300) })) },
    signal,
  });
  signal?.throwIfAborted();
  if (error || data?.error) throw new Error('Assistant service unavailable');
  if (!data || !Array.isArray(data.calls) || data.calls.length > 6 || typeof data.reply !== 'string') throw new Error('Invalid assistant response');
  // Invalid plans must NOT fall through into the less expressive offline parser.
  return { reply: data.reply.slice(0, 1000), calls: data.calls };
}
