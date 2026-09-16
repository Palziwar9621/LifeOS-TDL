// LifeOS — Supabase client factory
// Values come from localStorage (set on the in-app Setup screen) or build-time env.
// Supabase anon keys are safe to ship in clients by design (RLS protects data).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LS_KEY = 'lifeos.supabase';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function loadSupabaseConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SupabaseConfig;
      if (parsed.url && parsed.anonKey) return parsed;
    }
  } catch { /* ignore */ }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey };
  return null;
}

function saveSupabaseConfig(cfg: SupabaseConfig | null) {
  try {
    if (cfg) localStorage.setItem(LS_KEY, supabaseConfigKey(cfg));
    else localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}

function supabaseConfigKey(cfg: SupabaseConfig): string {
  return JSON.stringify({ url: cfg.url, anonKey: cfg.anonKey });
}

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  if (client) return client;
  const cfg = loadSupabaseConfig();
  if (!cfg) return null;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storageKey: 'lifeos.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // avoid magic-link hash weirdness in PWA context
    },
    realtime: { params: { eventsPerSecond: 8 } },
  });
  return client;
}

export function setSupabaseConfig(cfg: SupabaseConfig) {
  saveSupabaseConfig(cfg);
  client = null;
}

export function hasSupabase(): boolean {
  return getClient() !== null;
}

export function clearSupabaseConfig() {
  saveSupabaseConfig(null);
  client = null;
}
