import { validateToolCall, type ToolCall } from '../../supabase/functions/assistant/contract';

/** Exact matches win, but even exact duplicates require clarification. */
export function matchOne<T>(rows: T[], query: string, label: (row: T) => string): T {
  const q = query.trim().toLocaleLowerCase();
  if (!q) throw new Error('Which item do you mean?');
  const exact = rows.filter(row => label(row).trim().toLocaleLowerCase() === q);
  const matches = exact.length ? exact : rows.filter(row => label(row).toLocaleLowerCase().includes(q));
  if (!matches.length) throw new Error(`I couldn’t find “${query}”.`);
  if (matches.length > 1) throw new Error(`I found ${matches.length} matches for “${query}”. Please use a unique title; identical titles need to be renamed in the app first.`);
  return matches[0];
}

/** Deliberately anchored: “stop laundry repeating” is a data command. */
export function stopIntent(text: string): 'end' | 'interrupt' | null {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hey lifeos |hello lifeos )/, '').replace(/^(?:(?:can|could|would) you |please |okay |ok )/, '').replace(/ (?:please|thanks|thank you)$/, '');
  if (/^(?:stop listening(?: to me)?|(?:turn|switch) (?:the )?assistant off|(?:turn|switch) off (?:the )?assistant|stop (?:the )?assistant|end (?:this |the )?(?:chat|conversation)|(?:i'm|i am|we're|we are) (?:done|finished)(?: (?:talking|here|for now))?|that's (?:all|enough)(?: for now)?|that is (?:all|enough)|goodbye|bye(?: lifeos)?|go (?:quiet|silent)|be quiet|stop (?:talking|chatting)(?: now)?|shut up)$/.test(t)) return 'end';
  if (/^(?:stop(?: it)?|cancel(?: that)?|wait(?: a (?:second|moment))?|hold on|never ?mind|don't do (?:that|it))$/.test(t)) return 'interrupt';
  return null;
}

export interface PlanResult { ok: boolean; message: string; cancelled?: boolean; results: string[] }
export async function executePlan(calls: ToolCall[], run: (call: ToolCall) => Promise<string>, signal?: AbortSignal): Promise<PlanResult> {
  const results: string[] = [];
  // Validate the whole plan first, so a malformed later tool cannot cause a partial plan.
  let safe: ToolCall[];
  try {
    if (calls.length > 6) throw new Error('Please ask for up to six changes at a time.');
    safe = calls.map(validateToolCall);
  } catch (e) { return { ok: false, message: (e as Error).message, results }; }
  for (const call of safe) {
    if (signal?.aborted) return { ok: false, cancelled: true, message: results.join(' '), results };
    try { results.push(await run(call)); }
    catch (e) {
      // Do not continue a dependent plan after a missing/ambiguous target or failed write.
      return { ok: false, message: [...results, (e as Error).message || 'That action failed.'].join(' '), results };
    }
  }
  return { ok: true, message: results.join(' '), results, ...(signal?.aborted ? { cancelled: true } : {}) };
}
