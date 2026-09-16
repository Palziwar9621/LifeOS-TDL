// LifeOS — Library hub: Notes + Ideas + Remember in one place (less scattered nav)
import React, { useState } from 'react';
import { NotesPage } from './NotesPage';
import { IdeasPage } from './IdeasPage';
import { RememberPage } from './RememberPage';

type Tab = 'notes' | 'ideas' | 'remember';

const TABS: { key: Tab; label: string }[] = [
  { key: 'notes', label: '📝 Notes' },
  { key: 'ideas', label: '💡 Ideas' },
  { key: 'remember', label: '📌 Remember' },
];

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('notes');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Library</h1>
        <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
          {TABS.map((t) => (
            <button key={t.key}
              className={`px-4 py-2 text-sm font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'notes' && <NotesPage />}
      {tab === 'ideas' && <IdeasPage />}
      {tab === 'remember' && <RememberPage />}
    </div>
  );
}
