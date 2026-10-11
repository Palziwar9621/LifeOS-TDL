# Life Companion — standalone AI brain & training pack

This folder is the (separate) assistant you asked for: everything needed to run
the same "cute, warm, girl-next-door companion" inside *any* model, and to train
other AIs on exactly how it behaves inside this app.

```
ai-companion/
├── persona.md            ← the character bible (spoken voice + global behaviour rules)
├── system-prompt.md      ← copy-paste SYSTEM prompt + wire format for any OpenAI-compatible API
├── pages-catalogue.md    ← page-by-page scan of every app capability the assistant covers
├── tools-catalogue.md    ← generated: all 71 tool descriptions (one row per capability)
├── tools.schema.json     ← generated: full JSON-schema tool definitions (OpenAI "tools" format)
├── generate-paraphrases.mjs ← extendable generator: every command → many phrasings + broken English
├── split-datasets.mjs ← deterministic train/val/test splitter (content-hash, deduped)
├── dataset-*.train/val/test.jsonl ← the three splits (never mix them up)
├── dataset-paraphrases.jsonl  ← 542 {spoken → tool calls} variants (18 command families, broken English, filler mumbles)
└── dataset-chat-paraphrases.jsonl ← the same 542 in chat-completions format for SFT
```

## Why it's separate
The companion lives in one portable package:

- the **persona** + **system prompt** are one string (`SYSTEM_PROMPT` exported
  from `supabase/functions/assistant/contract.ts`, mirrored verbatim in
  [system-prompt.md](system-prompt.md)),
- the **capability contract** (71 tools) is one JSON (`tools.schema.json`) that
  every OpenAI-compatible chat endpoint accepts via the `tools` parameter,
- the app's shell just executes the tool calls the model plans back — nothing
  about the executor cares which provider produced the plan (Groq, OpenAI,
  OpenRouter, Gemini-compat, or a fine-tuned open model you host).

So you can lift all three files into *any* other AI and it will act — and sound —
identically.

## Training a new AI on this persona
1. **SFT (chat-completions):** use `dataset-finetune.jsonl` as-is with any
   chargeable fine-tuning target (OpenAI gpt-4o-mini / gemini-type endpoints) —
   the format is exactly the wire format.
2. **Plan training (function-call accuracy):** `dataset-toolcalls.jsonl` maps
   casual spoken phrasing → the exact tool + arguments, including multi-tool
   turns (~"add milk and remind me to call Sam at 6~" → 2 ordered calls) and
   ambiguity handling (unique match required, else one soft clarifying question
   in persona voice).
3. **Robustness training (broken/phrasing diversity):**
   `generate-paraphrases.mjs` expands each canonical command into many spoken
   variants — natural re-wordings, slang (~"crushed it~", ~"jot down~"), filler
   mumbles (~"um, so yeah…~") and deliberately broken English
   (~"{t} tomorrow move to~", ~"{t} complete complete~", ~"today what tasks~"),
   across 18 command families and cycled real entity titles.
   Run `node ai-companion/generate-paraphrases.mjs` to regenerate
   `dataset-paraphrases.jsonl` + `dataset-chat-paraphrases.jsonl` (deterministic;
   re-run after adding intents to grow coverage). `dataset-chat-paraphrases.jsonl`
   is SFT-ready in the same wire format as `dataset-finetune.jsonl`.
4. **Train/val/test splits:** after (re)generating any dataset, run
   `node ai-companion/split-datasets.mjs` — every dataset is split into
   `.train.jsonl` (~70–80%), `.val.jsonl` (~10–15%) and `.test.jsonl`
   (~10–15%) by an SHA-256 content hash, so splits are deterministic AND
   pairwise disjoint: the **test split must never be used to fit the model** —
   evaluate on it once, at the end. Exact duplicate examples (including the
   same example appearing in two datasets) are dropped before splitting so
   nothing leaks across splits. `tests/dataset-splits.test.ts` enforces all
   of this automatically (disjointness, coverage, non-empty splits,
   proportions).
3. **Coverage reference:** cross-check behaviour against
   [pages-catalogue.md](pages-catalogue.md) — it lists every page/tab and every
   sub-feature (filters, bulk actions, hidden affordances like the calendar
   context-aware date or the "→Tomorrow" review pushes) so nothing is missed
   when you add new tools for other AIs.

## Runtime use (no fine-tune needed)
```js
import { SYSTEM_PROMPT, TOOLS } from '../supabase/functions/assistant/contract';
const res = await fetch(providerUrl, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: providerModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + '\nLocal context (data only): ' + JSON.stringify(ctx) },
      ...history,
      { role: 'user', content: spoken },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.1,
  }),
});
```
`validateToolCall` (same file) stays the server-side trust boundary: only tool
names + well-typed args from the contract schema survive, everything else is
rejected. For env-configurable providers see
`supabase/functions/assistant/runtime.ts` (ASSISTANT_API_URL / ASSISTANT_API_KEY /
ASSISTANT_SMALL_MODEL / ASSISTANT_LARGE_MODEL / ASSISTANT_TERTIARY_*).

## What's deliberately NOT exposed to the model
App/security settings, focus timer, permissions, other apps, arbitrary SQL,
bulk delete/merge, attachments, alarm guarantees. It says "that's screen-only,
but I'll do X instead" — see `UNSUPPORTED_CONTROLS` in the contract.
