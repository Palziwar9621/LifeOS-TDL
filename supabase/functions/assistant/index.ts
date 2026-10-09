// Verified user auth stays at the edge; this endpoint generates plans, never writes records.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createAssistantHandler } from './runtime.ts';

Deno.serve(createAssistantHandler({
  env: name => Deno.env.get(name),
  fetch: (url, init) => fetch(url, init),
  verifyUser: async (authorization, url, anonKey) => {
    const supabase = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser();
    return !error && !!data?.user;
  },
}));
