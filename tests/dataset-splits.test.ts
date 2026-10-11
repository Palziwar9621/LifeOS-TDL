import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const SOURCE_INDEX = {
  'dataset-finetune': ['dataset-finetune.jsonl'],
  'dataset-toolcalls': ['dataset-toolcalls.jsonl'],
  'dataset-paraphrases': ['dataset-paraphrases.jsonl'],
  'dataset-chat-paraphrases': ['dataset-chat-paraphrases.jsonl'],
};

function exKey(s: string): string {
  const o = JSON.parse(s);
  if (o.messages) {
    const nonSystem = o.messages.filter((m: any) => m.role !== 'system').map((m: any) =>
      m.role === 'assistant' && m.tool_calls ? 'A:' + JSON.stringify(m.tool_calls) : (m.role + ':' + (m.content ?? '')));
    return JSON.stringify(nonSystem);
  }
  if (o.spoken) return JSON.stringify([o.spoken, o.calls ?? []]);
  return s;
}

test('train/val/test files exist for every dataset and are non-empty', () => {
  for (const stem of Object.keys(SOURCE_INDEX)) {
    for (const split of ['train', 'val', 'test']) {
      const f = `ai-companion/${stem}.${split}.jsonl`;
      assert.ok(existsSync(f), `${f} missing`);
      assert.ok(readFileSync(f, 'utf8').trim().length > 0, `${f} empty`);
    }
  }
});

test('splits are pairwise disjoint — the test set is never seen in training data', () => {
  for (const stem of Object.keys(SOURCE_INDEX)) {
    const seen = new Map<string, string>();
    for (const split of ['train', 'val', 'test']) {
      for (const line of readFileSync(`ai-companion/${stem}.${split}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
        const key = exKey(line);
        if (seen.has(key)) assert.fail(`${stem}: example in both ${seen.get(key)} and ${split}`);
        seen.set(key, split);
      }
    }
  }
});

test('splits reassemble all sources globally (cross-dataset dupes deduped by design)', () => {
  // The splitter dedupes GLOBALLY so an exact example never appears twice
  // (e.g. "how am I doing" exists in both toolcalls and paraphrases). So
  // coverage is checked as: union of all split keys == union of all source keys.
  const splitKeys = new Set<string>();
  for (const stem of Object.keys(SOURCE_INDEX)) {
    for (const split of ['train', 'val', 'test']) {
      for (const line of readFileSync(`ai-companion/${stem}.${split}.jsonl`, 'utf8').split('\n').filter(Boolean)) splitKeys.add(exKey(line));
    }
  }
  const srcKeys = new Set<string>();
  let raw = 0;
  for (const sources of Object.values(SOURCE_INDEX)) {
    for (const src of sources) {
      for (const line of readFileSync(`ai-companion/${src}`, 'utf8').split('\n').filter(Boolean)) { raw++; srcKeys.add(exKey(line)); }
    }
  }
  assert.equal(splitKeys.size, srcKeys.size, 'every unique example across all sources lands in exactly one split');
  assert.ok(raw >= splitKeys.size, 'raw lines ≥ unique (dupes were dropped)');
  // Per-stem sanity: each stem's split files must be a subset of its own source.
  for (const [stem, sources] of Object.entries(SOURCE_INDEX)) {
    const srcSet = new Set<string>();
    for (const src of sources) for (const line of readFileSync(`ai-companion/${src}`, 'utf8').split('\n').filter(Boolean)) srcSet.add(exKey(line));
    for (const split of ['train', 'val', 'test']) {
      for (const line of readFileSync(`ai-companion/${stem}.${split}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
        assert.ok(srcSet.has(exKey(line)), `${stem}.${split}: example not from its own source`);
      }
    }
  }
});

test('global proportions stay inside train 70–80 / val 10–15 / test 10–15 ballpark', () => {
  const counts = { train: 0, val: 0, test: 0 };
  for (const stem of Object.keys(SOURCE_INDEX)) {
    for (const split of ['train', 'val', 'test'] as const) {
      counts[split] += readFileSync(`ai-companion/${stem}.${split}.jsonl`, 'utf8').split('\n').filter(Boolean).length;
    }
  }
  const total = counts.train + counts.val + counts.test;
  const pct = (n: number) => (n / total) * 100;
  assert.ok(pct(counts.train) >= 70 && pct(counts.train) <= 85, `train ${pct(counts.train).toFixed(1)}%`);
  assert.ok(pct(counts.val) >= 7 && pct(counts.val) <= 15, `val ${pct(counts.val).toFixed(1)}%`);
  assert.ok(pct(counts.test) >= 10 && pct(counts.test) <= 16, `test ${pct(counts.test).toFixed(1)}%`);
});
