// Trainable-paraphrase generator: expands every canonical app command into
// MANY spoken variants — natural rephrasings, slang, filler-prefixed mumbles,
// and deliberately broken English — as {spoken → tool calls} JSONL for
// plan-training any AI. Deterministic: no randomness, re-runs are identical.
// Run: node ai-companion/generate-paraphrases.mjs
import { writeFileSync } from 'node:fs';

const FILLERS = ['um', 'uh', 'okay so', 'so yeah', 'hey', 'right so', 'well'];
const fill = (tmpl, map) => tmpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? `{${k}}`);

// Command families: each maps canonical intent → many spoken variants.
// Placeholders: {t}=title, {p}=page/project/person, {d}=date, {time}, {m}=minutes.
const FAMILIES = [
  {
    key: 'add_task',
    calls: (t) => [{ name: 'add_task', args: { title: t, due_date: '2026-10-11', priority: 'medium' } }],
    variants: (t) => [
      `${t}`, `add task ${t}`, `add a task ${t}`, `new task ${t}`, `create task ${t}`, `make a task ${t}`,
      `need to ${t}`, `gotta ${t}`, `I need ${t}`, `put ${t} on the list`, `let me get ${t} on there`,
      `task ${t} add please`, `${t} add task`, `add add task ${t}`, `add task ${t} for me now`,
      `hey um add task ${t}`, `okay so new task ${t}`,
    ],
  },
  {
    key: 'complete_task',
    calls: (t) => [{ name: 'complete_task', args: { title_match: t } }],
    variants: (t) => [
      `I finished ${t}`, `mark ${t} as done`, `${t} is done`, `complete ${t}`, `check off ${t}`, `tick off ${t}`,
      `mark ${t} complete`, `just did ${t}`, `done with ${t}`, `${t} got done`, `crushed ${t} today`,
      `${t} did finish`, `finish ${t} I did`, `${t} complete complete`, `done done ${t}`, `mark done ${t} ok yes`,
      `um ${t} is done I think`, `${t} done done today yes`,
    ],
  },
  {
    key: 'reopen_task',
    calls: (t) => [{ name: 'update_task', args: { title_match: t, status: 'planned' } }],
    variants: (t) => [
      `reopen ${t}`, `untick ${t}`, `uncheck ${t}`, `mark ${t} not done`, `wasn't ${t} done after all`,
      `${t} not done make`, `undo ${t} done`, `no ${t} not complete change it`,
    ],
  },
  {
    key: 'delete_task',
    calls: (t) => [{ name: 'delete_task', args: { title_match: t } }],
    variants: (t) => [
      `delete ${t}`, `delete task ${t}`, `remove ${t} task`, `get rid of ${t}`, `I don't need ${t} anymore`,
      `${t} delete from list`, `delete delete ${t}`, `remove ${t} it task delete`,
    ],
  },
  {
    key: 'complete_routine',
    calls: (t) => [{ name: 'complete_routine', args: { title_match: t, date: '2026-10-11', done: true } }],
    variants: (t) => [
      `ticked ${t}`, `did my ${t} today`, `mark ${t} done for today`, `${t} is checked today`,
      `${t} ticked yes for today`, `tick ${t} today done`, `did did ${t} today`, `${t} today tick me ok`,
    ],
  },
  {
    key: 'uncomplete_routine',
    calls: (t) => [{ name: 'complete_routine', args: { title_match: t, date: '2026-10-11', done: false } }],
    variants: (t) => [
      `didn't do ${t} today`, `untick ${t}`, `not ${t} today`, `${t} missed today sorrry`,
      `${t} today not done make`,
    ],
  },
  {
    key: 'add_routine_daily',
    calls: (t) => [{ name: 'add_routine', args: { title: t, days: [0, 1, 2, 3, 4, 5, 6] } }],
    variants: (t) => [
      `add ${t} to my routine`, `put ${t} on my daily checklist`, `new routine ${t} every day`,
      `routine ${t} daily`, `${t} in productivity checklist put`, `add add ${t} routine every day`,
      `routine routine ${t} daily yes`,
    ],
  },
  {
    key: 'reschedule_tomorrow',
    calls: (t) => [{ name: 'reschedule_task', args: { title_match: t, when: 'tomorrow' } }],
    variants: (t) => [
      `push ${t} to tomorrow`, `move ${t} to tomorrow`, `change ${t} to tomorrow`, `reschedule ${t} tomorrow`,
      `${t} tomorrow move to`, `move ${t} tomorrow day`, `shift ${t} for tomorrow`,
    ],
  },
  {
    key: 'reschedule_next_week',
    calls: (t) => [{ name: 'reschedule_task', args: { title_match: t, when: 'next_week' } }],
    variants: (t) => [
      `${t} to next week`, `push ${t} next week please`, `reschedule ${t} for next week`,
      `${t} next week it push`, `move move ${t} next week`,
    ],
  },
  {
    key: 'snooze',
    calls: (t, m) => [{ name: 'snooze_reminder', args: { title_match: t, minutes: m } }],
    nums: [10, 30],
    variants: (t, m) => [
      `snooze that ${m} minutes`, `snooze ${t} for ${m} minutes`, `${t} again in ${m} min`,
      `${t} snooze ${m} minute`, `snooze snooze ${t} thing`, `${t} later ${m} minutes ok`,
    ],
  },
  {
    key: 'add_reminder',
    calls: (t) => [{ name: 'add_reminder', args: { title: t, due_at: '2026-10-11T17:00:00Z' } }],
    variants: (t) => [
      `remind me about ${t} at 5 pm`, `set a reminder ${t} at 5 pm`, `reminder ${t} 5 pm`,
      `${t} remidner 5 pm set`, `remind ${t} 5 pm me`, `${t} 5 pm alarm thing make`,
    ],
  },
  {
    key: 'add_note',
    calls: (t) => [{ name: 'add_note', args: { title: t, content: '' } }],
    variants: (t) => [
      `note ${t}`, `add note ${t}`, `write down ${t}`, `jot down ${t}`, `new note ${t}`,
      `${t} note add`, `note note ${t}`, `write write ${t} note`,
    ],
  },
  {
    key: 'add_idea',
    calls: (t) => [{ name: 'add_idea', args: { title: t } }],
    variants: (t) => [
      `new idea ${t}`, `idea ${t}`, `capture idea ${t}`, `put ${t} in my ideas`,
      `${t} idea make`, `idea idea ${t}`, `${t} to ideas add now`,
    ],
  },
  {
    key: 'navigate_tasks',
    calls: () => [{ name: 'navigate', args: { page: 'tasks' } }],
    variants: () => [
      `open tasks`, `go to tasks`, `show my tasks`, `take me to tasks`, `switch to tasks page`,
      `tasks open`, `tasks go there`, `tasks page show me`,
    ],
  },
  {
    key: 'navigate_today_view',
    calls: () => [{ name: 'navigate', args: { page: 'tasks', view: 'today' } }],
    variants: () => [
      `open today tasks`, `show my overdue... no wait, today ones`, `today view open in tasks`,
    ],
  },
  {
    key: 'query_tasks_today',
    calls: () => [{ name: 'query_tasks', args: { date_range: 'today' } }],
    variants: () => [
      `what's on today`, `what do I have today`, `my day read out`, `what's left today`,
      `today what tasks`, `tasks today show all`, `what today have me ${''}`,
    ],
  },
  {
    key: 'query_stats',
    calls: () => [{ name: 'query_stats', args: { scope: 'overview' } }],
    variants: () => [
      `how am I doing`, `my stats`, `show my progress`, `stats me`, `how doing me`,
      `progress mine show`, `my week how numbers look`,
    ],
  },
  {
    key: 'summarize_day',
    calls: () => [{ name: 'summarize_day', args: {} }],
    variants: () => [
      `what's on my day`, `summarize my day`, `read me today`, `today me what have`,
      `summarize summarize today thing`,
    ],
  },
];

// Build rows: real sample entities per family, cycled so variants exercise
// different titles rather than a single noun.
const TASKS = ['laundry', 'math homework', 'call mom', 'grocery run', 'vacuum the car'];
const REMINDERS = ['call the bank', 'trash day', 'water the plants', 'pay the power bill'];
const REMINDER = 'call the bank';

let rows = [];
let seq = 0;
function emit(key, spoken, calls) {
  rows.push({ id: `p${++seq}`, family: key, spoken, calls });
}

for (const fam of FAMILIES) {
  if (fam.key === 'snooze') {
    for (const m of fam.nums) {
      for (const v of fam.variants(REMINDER, m)) emit(fam.key, v, fam.calls(REMINDER, m));
    }
    continue;
  }
  if (fam.key.startsWith('navigate') || fam.key.startsWith('query') || fam.key.startsWith('summarize')) {
    for (const v of fam.variants(null)) emit(fam.key, v.replace(/\s+/g, ' ').trim(), fam.calls(null));
    continue;
  }
  // Pick an entity pool per family so noun/verb agreement stays sane.
  const pool = fam.key.startsWith('add_reminder')
    ? REMINDERS
    : fam.key === 'add_routine_daily'
      ? ['gym', 'read 20 pages', 'drink water']
      : TASKS;
  const variants = fam.variants('X');
  pool.forEach((entity, poolIdx) => {
    for (const v of variants) {
      const filled = v.replaceAll('X', entity);
      emit(fam.key, filled.replace(/\s+/g, ' ').trim(), fam.calls(entity));
    }
  });
}

// Filler-prefix pass: natural mumble openings on a deterministic slice.
const withFillers = rows.map((r, i) => (i % 4 === 0 ? { ...r, spoken: `${FILLERS[i % FILLERS.length]}, ${r.spoken}` } : r));

writeFileSync(new URL('./dataset-paraphrases.jsonl', import.meta.url), withFillers.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`dataset-paraphrases.jsonl written: ${withFillers.length} variants across ${FAMILIES.length} command families`);
