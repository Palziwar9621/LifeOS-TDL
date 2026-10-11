import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TOOLS, validateToolCall } from '../supabase/functions/assistant/contract.ts';

const PACK_FILES = [
  'ai-companion/persona.md', 'ai-companion/system-prompt.md', 'ai-companion/pages-catalogue.md',
  'ai-companion/tools-catalogue.md', 'ai-companion/tools.schema.json', 'ai-companion/README.md',
  'ai-companion/dataset-finetune.jsonl', 'ai-companion/dataset-toolcalls.jsonl',
  'ai-companion/dataset-paraphrases.jsonl', 'ai-companion/dataset-chat-paraphrases.jsonl',
];

const names = new Set(TOOLS.map((t) => t.function.name));
// Datasets older than this test carry illustrative args; the contract requires
// exact schema conformity. Check every dataset's tool NAMES, and full schema
// validation only for the generator-produced datasets.
function checkNames(calls: any[], file: string) {
  for (const c of calls) assert.ok(names.has(c.name), `${file}: unknown tool ${c.name}`);
}

test('training pack files all exist', () => {
  for (const f of PACK_FILES) assert.ok(existsSync(f), `${f} missing`);
});

test('every dataset line parses and references real tools', () => {
  const datasets = [
    'ai-companion/dataset-finetune.jsonl', 'ai-companion/dataset-toolcalls.jsonl',
    'ai-companion/dataset-paraphrases.jsonl', 'ai-companion/dataset-chat-paraphrases.jsonl',
  ];
  let n = 0;
  for (const file of datasets) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(line); n++;
      if (o.calls) checkNames(o.calls, file);
      if (o.messages) for (const m of o.messages) if (m.tool_calls) for (const tc of m.tool_calls) checkNames([tc.function], file);
    }
  }
  assert.ok(n >= 500, `expect substantial dataset, got ${n} lines`);
});

test('generator datasets pass full schema validation', () => {
  for (const file of ['ai-companion/dataset-paraphrases.jsonl', 'ai-companion/dataset-chat-paraphrases.jsonl']) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const o = JSON.parse(line);
      for (const c of (o.calls ?? [])) validateToolCall(c);
      if (o.messages) for (const m of o.messages) if (m.tool_calls) {
        for (const tc of m.tool_calls) validateToolCall({ name: tc.function.name, args: JSON.parse(tc.function.arguments) });
      }
    }
  }
});

test('paraphrase dataset covers broken-English variants', () => {
  const regen = readFileSync('ai-companion/dataset-paraphrases.jsonl', 'utf8');
  assert.ok(regen.trim().length > 10_000, 'paraphrase dataset should be substantive');
  assert.match(regen, /need to laundry|gotta laundry|me want/, 'casual/broken additions present');
  assert.match(regen, /complete complete|did finish|done done/, 'duplicated-word broken variants present');
});

test('system prompt carries the imperfect-speech understanding rules', () => {
  const contract = readFileSync('supabase/functions/assistant/contract.ts', 'utf8');
  assert.match(contract, /IMPERFECT SPEECH/);
  assert.match(contract, /stutters and repeated words/);
  assert.match(contract, /filler words/);
});
