import { currentUserId } from './db';

export type AssistantMemoryEntry = { role: 'user' | 'assistant'; content: string };

// This is conversation context, not an archive. Keep it small enough that it
// cannot turn every voice turn into a large provider request.
export const ASSISTANT_MEMORY_MAX_ENTRIES = 12;
export const ASSISTANT_MEMORY_MAX_CHARS = 2_400;
const ENTRY_MAX_CHARS = 300;
const KEY_PREFIX = 'lifeos.assistant.memory.v1.';

/** The key is deliberately scoped to the active account or stable guest id. */
export function assistantMemoryUserId(): string | null {
  // Guests already have a stable, namespaced id in the initialized store.
  // Never share an anonymous bucket during sign-out or store initialization.
  return currentUserId();
}

function storageKey(userId: string): string {
  return KEY_PREFIX + encodeURIComponent(userId);
}

const PRIVATE_TURN = /\b(?:notes?|ideas?|remember(?: items?)?|content|description|body|journal|password|secret)\b/i;

/** Never archive dictation or document-body requests as conversation text. */
export function sanitizeAssistantMemoryContent(content: string, role: AssistantMemoryEntry['role']): string {
  let text = content.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (PRIVATE_TURN.test(text)) text = '[Private document turn omitted]';
  return text.slice(0, ENTRY_MAX_CHARS);
}

export function compactAssistantHistory(history: AssistantMemoryEntry[] = [], maxEntries = 8, maxChars = ASSISTANT_MEMORY_MAX_CHARS): AssistantMemoryEntry[] {
  const compacted: AssistantMemoryEntry[] = [];
  let privateTurn = false;
  const sanitized: AssistantMemoryEntry[] = [];
  // Look one entry behind the window so a document reply never loses the
  // privacy classification of the user request immediately before it.
  for (const entry of history.slice(-maxEntries - 1)) {
    if (!entry || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.content !== 'string') continue;
    if (entry.role === 'user') privateTurn = PRIVATE_TURN.test(entry.content) || entry.content === '[Private document turn omitted]';
    sanitized.push({ role: entry.role, content: privateTurn ? '[Private document turn omitted]' : sanitizeAssistantMemoryContent(entry.content, entry.role) });
  }
  let chars = 0;
  for (const entry of sanitized.slice(-maxEntries).reverse()) {
    const content = entry.content;
    if (!content || chars + content.length > maxChars) continue;
    compacted.push({ role: entry.role, content });
    chars += content.length;
  }
  return compacted.reverse();
}

export function loadAssistantMemory(userId = assistantMemoryUserId()): AssistantMemoryEntry[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    // Refuse unexpectedly large/corrupt values before parsing them. Normal
    // bounded memory serializes well below this ceiling.
    if (!raw || raw.length > 16_000) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? compactAssistantHistory(parsed, ASSISTANT_MEMORY_MAX_ENTRIES, ASSISTANT_MEMORY_MAX_CHARS) : [];
  } catch { return []; }
}

export function saveAssistantMemory(entries: AssistantMemoryEntry[], userId = assistantMemoryUserId()): AssistantMemoryEntry[] {
  const compacted = compactAssistantHistory(entries, ASSISTANT_MEMORY_MAX_ENTRIES, ASSISTANT_MEMORY_MAX_CHARS);
  if (!userId) return [];
  try { localStorage.setItem(storageKey(userId), JSON.stringify(compacted)); } catch { /* storage unavailable */ }
  return compacted;
}

export function appendAssistantMemory(entries: AssistantMemoryEntry[], userId = assistantMemoryUserId()): AssistantMemoryEntry[] {
  return saveAssistantMemory([...loadAssistantMemory(userId), ...entries], userId);
}
