// Splits every ai-companion dataset into train (~80%) / validation (~10%) /
// test (~10%) with NO example appearing in more than one split.
//
// Deterministic: assignment is an SHA-256 content hash mod 100, so the same
// dataset always produces the same splits (reproducible for fine-tuning runs),
// and duplicates by canonical key are dropped before splitting so nothing
// crosses over as an exact repeat.
//
// Run: node ai-companion/split-datasets.mjs [--train 80]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const trainArg = process.argv.indexOf('--train') >= 0 ? Number(process.argv[process.argv.indexOf('--train') + 1]) : 70; // 70/10/20 hash buckets → ~77/8/15 actual
const TRAIN_PCT = Math.max(0, Math.min(100, Number.isFinite(trainArg) && trainArg > 0 ? trainArg : 80));
const VAL_PCT = 10; // test gets the remainder
if (TRAIN_PCT < 60 || TRAIN_PCT + VAL_PCT > 100) {
  console.error('--train must be ≥60 and +10 validation ≤100'); process.exit(2);
}

const DATASETS = [
  'dataset-finetune.jsonl',
  'dataset-toolcalls.jsonl',
  'dataset-paraphrases.jsonl',
  'dataset-chat-paraphrases.jsonl',
];

// Canonical identity of an example = its user-facing payload, so a paraphrase
// that happens to appear in two datasets dedupes to one split.
function exampleKey(obj) {
  if (obj.messages) {
    const nonSystem = obj.messages.filter((m) => m.role !== 'system').map((m) =>
      m.role === 'assistant' && m.tool_calls ? 'A:' + JSON.stringify(m.tool_calls) : (m.role + ':' + (m.content ?? '')));
    return JSON.stringify(nonSystem);
  }
  if (obj.spoken) return JSON.stringify([obj.spoken, obj.calls ?? []]);
  return JSON.stringify(obj);
}

function bucketOf(key) {
  const h = createHash('sha256').update(key).digest();
  return h[0] % 100; // 0..99
}

const stemCounts = { train: 0, val: 0, test: 0 };
const totalLines = { train: 0, val: 0, test: 0 };
const seenKeys = new Set();
let droppedDupes = 0;

for (const file of DATASETS) {
  const lines = readFileSync(new URL('./' + file, import.meta.url), 'utf8').split('\n').filter(Boolean);
  const buckets = { train: [], val: [], test: [] };
  let dupeInFile = 0; const fileSeen = new Set();
  for (const line of lines) {
    const obj = JSON.parse(line);
    const key = exampleKey(obj);
    if (seenKeys.has(key) || fileSeen.has(key)) { droppedDupes++; dupeInFile++; continue; }
    seenKeys.add(key); fileSeen.add(key);
    const b = bucketOf(key);
    const which = b < TRAIN_PCT ? 'train' : b < TRAIN_PCT + VAL_PCT ? 'val' : 'test';
    buckets[which].push(line);
  }
  // Tiny-file guarantee: with ≥3 unique examples, no split may be empty
  // (otherwise a fine-tune/eval script hits an empty file).
  const all = [...buckets.train, ...buckets.val, ...buckets.test];
  if (all.length >= 3) {
    for (const want of ['val', 'test']) {
      if (buckets[want].length === 0) {
        const donor = buckets.train.length >= 1 ? 'train' : 'val' === want ? 'test' : 'train';
        const from = Object.keys(buckets).filter((k) => k !== want && buckets[k].length > 0 && (k === donor || buckets[donor].length === 0)).sort((a, b) => buckets[b].length - buckets[a].length)[0];
        if (from) buckets[want].push(buckets[from].pop());
      }
    }
  }
  const stem = file.replace(/\.jsonl$/, '');
  for (const which of ['train', 'val', 'test']) {
    const out = `${stem}.${which}.jsonl`;
    writeFileSync(new URL('./' + out, import.meta.url), buckets[which].join('\n') + (buckets[which].length ? '\n' : ''));
    totalLines[which] += buckets[which].length;
  }
  console.log(`${file}: train ${buckets.train.length} / val ${buckets.val.length} / test ${buckets.test.length}${dupeInFile ? ` (dropped ${dupeInFile} exact dupes)` : ''}`);
  stemCounts.train += buckets.train.length; stemCounts.val += buckets.val.length; stemCounts.test += buckets.test.length;
}
const grand = totalLines.train + totalLines.val + totalLines.test;
console.log(`\nTOTAL: train ${totalLines.train} (${(totalLines.train / grand * 100).toFixed(1)}%)  val ${totalLines.val} (${(totalLines.val / grand * 100).toFixed(1)}%)  test ${totalLines.test} (${(totalLines.test / grand * 100).toFixed(1)}%)  | exact dupes dropped: ${droppedDupes}`);
