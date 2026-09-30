// Supabase Edge Function: delete-account
// Permanently deletes the calling user's account and all owned data.
//
// Security model:
//  • The user ID is taken ONLY from the verified Authorization JWT — never
//    from the request body.
//  • Requires the SERVICE_ROLE_KEY secret (server-side only, set via
//    `supabase secrets set`); it is never exposed to clients.
//  • Idempotent: deleting an already-deleted user returns success.
//
// Deletion order: user-owned rows are removed explicitly first (tables whose
// FK to auth.users lacks ON DELETE CASCADE, plus tables referenced by RLS-only
// policies), then the auth user itself — which cascades the rest.
//
// Deploy:  npx supabase functions deploy delete-account
// Secrets: npx supabase secrets set SERVICE_ROLE_KEY=...   (project service_role)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_TABLES = [
  'profiles',
  'push_subscriptions',
  'user_settings',
  'task_tags',
  'subtasks',
  'project_milestones',
  'goal_milestones',
  'routine_completions',
  'routine_tasks',
  'focus_sessions',
  'reminders',
  'schedule_blocks',
  'remember_items',
  'ideas',
  'notes',
  'tasks',
  'goals',
  'projects',
  'categories',
  'tags',
] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const projectUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!serviceKey) {
      return new Response(
        JSON.stringify({ error: 'Server not configured for account deletion (SERVICE_ROLE_KEY missing).' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // ---- Identity: verified JWT only --------------------------------
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Verify the caller's access token with the Supabase auth server
    // (never trust a user_id from the request body).
    const uRes = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: { apikey: anonKey || serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!uRes.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const user = await uRes.json();
    const uid = user?.id;
    if (!uid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const admin = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };

    // ---- Delete user-owned rows (explicit, tolerant of missing tables) --
    // Most tables cascade from auth.users; a few (push_subscriptions etc.)
    // also cascade, but explicit deletes make the operation verifiable and
    // idempotent even if FKs change in future migrations.
    const deleted: Record<string, number> = {};
    for (const table of USER_TABLES) {
      try {
        const col = table === 'profiles' ? 'id' : table === 'user_settings' ? 'user_id' : 'user_id';
        const res = await fetch(`${projectUrl}/rest/v1/${table}?${col}=eq.${uid}`, {
          method: 'DELETE',
          headers: { ...admin, Prefer: 'return=representation' },
        });
        if (res.ok) {
          const rows = await res.json().catch(() => []);
          deleted[table] = Array.isArray(rows) ? rows.length : 0;
        } else if (res.status === 404) {
          deleted[table] = 0; // table not present in this deployment — skip
        } else {
          const detail = await res.text().catch(() => '');
          return new Response(
            JSON.stringify({ error: `Deletion failed at ${table}`, stage: table, status: res.status }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
          );
        }
      } catch {
        // network hiccup on one table — report failure so the client retries
        return new Response(
          JSON.stringify({ error: `Deletion failed at ${table}`, stage: table }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
    }

    // ---- Delete the auth user (cascades any remaining owned rows) ----
    const delRes = await fetch(`${projectUrl}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: admin,
    });
    if (!delRes.ok && delRes.status !== 404) {
      // 404 = already deleted → still a success (idempotent)
      return new Response(
        JSON.stringify({ error: 'Account deletion failed at auth step', status: delRes.status }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, deleted, deletedAt: new Date().toISOString() }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Unexpected server error during account deletion' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
