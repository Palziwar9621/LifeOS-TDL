// LifeOS — Edge Function: send-push
// Runs on a pg_cron schedule (every minute) with the service-role key, finds
// reminders / task alerts / routine alarms that are due right now, and sends
// a Web Push to every stored subscription via the Web Push protocol.
// Also accepts { test: true } for a manual test push from Settings.
//
// Self-contained Web Push implementation (RFC 8291 + RFC 8292 VAPID) using
// Deno's WebCrypto — no external push library needed.
//
// Required secrets (supabase secrets set):
//   VAPID_PUBLIC_KEY    — base64url public key (same as VITE_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY   — base64url private key

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- RFC 8291 message encryption (aes128gcm) ----------

async function ecdhSharedSecret(priv: CryptoKey, pub: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: pub }, priv, 256,
  ));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as any, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as any, info: info as any }, key, len * 8,
  );
  return new Uint8Array(bits);
}

/** Encrypts payload per RFC 8291 aes128gcm and returns the request body. */
async function encryptPayload(payload: string, p256dhB64: string, authB64: string) {
  const uaPublic = await crypto.subtle.importKey(
    'raw', b64urlToBytes(p256dhB64) as any,
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );
  // Ephemeral server key pair
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;

  const ecdhSecret = await ecdhSharedSecret(serverKeys.privateKey, uaPublic);
  const authSecret = b64urlToBytes(authB64);

  // RFC 8291 section 4.2: ikm = HKDF(authSecret, ecdhSecret, "WebPush: info\x00" | uaPub | asPub, 32)
  const uaPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', uaPublic));
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const info = new Uint8Array(19 + uaPubRaw.length + asPubRaw.length);
  info.set(enc.encode('WebPush: info\x00'), 0);
  info.set(uaPubRaw, 19);
  info.set(asPubRaw, 19 + uaPubRaw.length);
  const ikm = await hkdf(authSecret, ecdhSecret, info, 32);

  // Content-encryption key + nonce: salt = random 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\x00'), 12);

  // Payload: plaintext | delimiter(0x02) | padding Zeros
  const plaintext = enc.encode(payload);
  const padded = new Uint8Array(plaintext.length + 2);
  padded.set(plaintext, 0);
  padded[plaintext.length] = 2; // delimiter
  // last byte stays 0 (padding length byte at end)

  const key = await crypto.subtle.importKey('raw', cek as any, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as any, additionalData: enc.encode('') as any, tagLength: 128 },
    key, padded,
  ));

  // aes128gcm header: salt(16) | rs(4, big-endian, 4096) | idlen(1) | keyid(asPubRaw)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPubRaw.length;
  header.set(asPubRaw, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header, 0);
  body.set(ciphertext, header.length);
  return body;
}

// ---------- RFC 8292 VAPID authorization header ----------

async function vapidAuthorizationHeader(endpoint: string, publicKeyB64: string, privateKeyB64: string): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600;

  const jwtPayload = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: expiry,
    sub: 'mailto:alarms@lifeos.app',
  })));
  const jwtHeader = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const unsigned = `${jwtHeader}.${jwtPayload}`;

  // Import the private key (raw 32 bytes) into JWK for ES256 signing.
  const rawPriv = b64urlToBytes(privateKeyB64);
  const jwk = {
    kty: 'EC', crv: 'P-256', d: b64urlEncode(rawPriv),
    x: '', y: '',
  };
  // Derive public point from the public key param for the JWK (x,y).
  const pubBytes = b64urlToBytes(publicKeyB64);
  // Uncompressed point: 0x04 | X(32) | Y(32)
  jwk.x = b64urlEncode(pubBytes.slice(1, 33));
  jwk.y = b64urlEncode(pubBytes.slice(33, 65));

  const key = await crypto.subtle.importKey('jwk', jwk as any,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned) as any,
  ));
  // Convert DER signature to raw r|s (64 bytes) as required by RFC 8292.
  const rs = derToRaw(sig);
  return `vapid t=${unsigned}.${b64urlEncode(rs)}, k=${publicKeyB64}`;
}

/** Converts ASN.1 DER ECDSA signature to 64-byte raw r||s. */
function derToRaw(der: Uint8Array): Uint8Array {
  let rStart = 4, rLen = der[3];
  if (rLen > 32) { rStart += 1; rLen -= 1; }
  const r = der.slice(rStart, rStart + rLen);
  let sStart = rStart + rLen + 2, sLen = der[rStart + rLen + 1];
  if (sLen > 32) { sStart += 1; sLen -= 1; }
  const s = der.slice(sStart, sStart + sLen);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

// ---------- Web Push request ----------

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string, vapidPublic: string, vapidPrivate: string): Promise<{ ok: boolean; status?: number }> {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const auth = await vapidAuthorizationHeader(sub.endpoint, vapidPublic, vapidPrivate);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: auth,
      TTL: '300',
      Urgency: 'high',
    },
    body: body as any,
  });
  return { ok: res.ok || res.status === 201, status: res.status };
}

// ---------- Due-item discovery ----------

interface DueItem {
  key: string;
  user_id: string;
  title: string;
  body: string;
}

async function dueItems(supabase: any): Promise<DueItem[]> {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const items: DueItem[] = [];
  const horizon = now + 60_000;
  const backstop = now - 12 * 3600_000;

  const { data: rems } = await supabase
    .from('reminders')
    .select('id, user_id, title, notes, due_at, snoozed_until, done, deleted')
    .eq('done', false).eq('deleted', false);
  for (const r of rems ?? []) {
    const fireAt = new Date(r.snoozed_until ?? r.due_at).getTime();
    if (fireAt <= horizon && fireAt > backstop) {
      items.push({
        key: `rem:${r.id}:${r.snoozed_until ?? r.due_at}`,
        user_id: r.user_id,
        title: '⏰ ' + r.title,
        body: r.notes ?? 'Reminder — tap to open LifeOS',
      });
    }
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, user_id, title, due_date, due_time, reminder_minutes, status, deleted, archived')
    .not('reminder_minutes', 'is', null)
    .neq('status', 'completed').neq('status', 'cancelled').eq('deleted', false).eq('archived', false);
  for (const t of tasks ?? []) {
    if (!t.due_date) continue;
    const base = new Date(`${t.due_date}T${(t.due_time ?? '09:00').slice(0, 8)}`);
    const fireAt = base.getTime() - (t.reminder_minutes ?? 0) * 60000;
    if (fireAt <= horizon && fireAt > backstop) {
      items.push({ key: `task:${t.id}:${t.due_date}:${t.due_time}`, user_id: t.user_id, title: '⏰ Task due soon', body: t.title });
    }
  }

  const wd = new Date(`${today}T00:00:00`).getUTCDay();
  const { data: routines } = await supabase
    .from('routine_tasks')
    .select('id, user_id, title, time_of_day, days, weekday, extra_date, archived')
    .eq('archived', false)
    .not('time_of_day', 'is', null);
  const { data: comps } = await supabase
    .from('routine_completions')
    .select('task_id, done_date')
    .eq('done_date', today);
  const doneSet = new Set((comps ?? []).map((c: any) => c.task_id));
  for (const rt of routines ?? []) {
    const days: number[] = rt.days?.length ? rt.days : rt.weekday != null ? [rt.weekday] : [];
    if ((!days.includes(wd) && rt.extra_date !== today) || doneSet.has(rt.id)) continue;
    const fireAt = new Date(`${today}T${rt.time_of_day.slice(0, 8)}`).getTime();
    if (fireAt <= horizon && fireAt > now - 2 * 60_000) {
      items.push({ key: `routine:${rt.id}:${today}`, user_id: rt.user_id, title: '⏰ Routine time', body: rt.title });
    }
  }
  return items;
}

// ---------- HTTP handler ----------

Deno.serve(async (req) => {
  // Wrap everything so uncaught errors return their MESSAGE, not a blank 500.
  try {
    return await handle(req);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), stack: String(e?.stack ?? '').slice(0, 500) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function handle(req: Request): Promise<Response> {
  // Newer Supabase runtimes don't auto-inject these — fall back to explicit
  // secrets set via `supabase secrets set`.
  const projectUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
  const adminKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!projectUrl) return new Response(JSON.stringify({ error: 'SUPABASE_URL/PROJECT_URL secret not set' }), { status: 500 });
  if (!adminKey) return new Response(JSON.stringify({ error: 'SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY secret not set' }), { status: 500 });
  const supabase = createAdminClient(projectUrl, adminKey);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID secrets not set' }), { status: 500 });
  }

  // Caller: service-role (cron) or a signed-in user (test push).
  const token = auth.replace('Bearer ', '');
  const isService = token === adminKey;
  if (!isService) {
    // Verify the user's JWT via the Auth server REST endpoint.
    const uRes = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? adminKey, Authorization: `Bearer ${token}` },
    });
    if (!uRes.ok) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const u = await uRes.json();
    if (!u?.id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    body.user_id = u.id;
    body.test = true;
  }

  let subs: any[] = [];
  let items: DueItem[] = [];
  if (body.test) {
    const { data } = await supabase.from('push_subscriptions').select('*').eq('user_id', body.user_id);
    subs = data ?? [];
    items = [{ key: `test:${Date.now()}`, user_id: body.user_id, title: '🔔 LifeOS test alarm', body: 'Push works! Alarms will now ring even with the app closed.' }];
  } else {
    items = await dueItems(supabase);
    if (items.length) {
      const { data: fired } = await supabase.from('alarm_fires').select('key').in('key', items.map((i) => i.key));
      const firedSet = new Set((fired ?? []).map((f: any) => f.key));
      items = items.filter((i) => !firedSet.has(i.key));
    }
    if (items.length) {
      const { data } = await supabase.from('push_subscriptions')
        .select('*').in('user_id', [...new Set(items.map((i) => i.user_id))]);
      subs = data ?? [];
    }
  }
  if (!subs.length || !items.length) {
    return new Response(JSON.stringify({ sent: 0, items: items.length }), { status: 200 });
  }

  let sent = 0;
  const deadEndpoints: string[] = [];
  const perUser = new Map<string, DueItem[]>();
  for (const item of items) {
    const list = perUser.get(item.user_id) ?? [];
    list.push(item);
    perUser.set(item.user_id, list);
  }

  for (const sub of subs) {
    for (const item of perUser.get(sub.user_id) ?? []) {
      const payload = JSON.stringify({
        title: item.title, body: item.body,
        key: item.key, kind: item.key.split(':')[0], url: '/',
      });
      try {
        const r = await sendPush(sub, payload, vapidPublic, vapidPrivate);
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 410) deadEndpoints.push(sub.endpoint);
      } catch {
        // network/encryption failure — leave subscription, retry next minute
      }
    }
  }

  if (items.length && !body.test) {
    await supabase.from('alarm_fires').upsert(items.map((i) => ({ key: i.key })), { onConflict: 'key' });
  }
  for (const ep of deadEndpoints) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', ep);
  }

  return new Response(JSON.stringify({ sent, dead: deadEndpoints.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Minimal supabase-js-compatible client over fetch (avoids esm.sh at bundle time).
function createAdminClient(url: string, apiKey: string) {
  const call = async (method: string, path: string, body?: any, prefer?: string) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { data: res.ok ? (await res.json().catch(() => null)) : null, error: res.ok ? null : await res.text() };
  };

  // Fluent query builder: .from(t).select(c).eq(a,b).eq(c,d).not(...).in(...)
  function query(table: string, cols: string) {
    const params: string[] = [`select=${cols}`];
    const p = {
      eq(col: string, val: any) { params.push(`${col}=eq.${val}`); return p; },
      neq(col: string, val: any) { params.push(`${col}=neq.${val}`); return p; },
      in(col: string, vals: any[]) { params.push(`${col}=in.(${vals.join(',')})`); return p; },
      not(col: string, op: string, val: any) { params.push(`${col}=not.${op}.${val}`); return p; },
      async then(resolve: any, reject: any) {
        try { resolve(await call('GET', `${table}?${params.join('&')}`)); } catch (e) { reject(e); }
      },
    };
    return p;
  }

  return {
    from: (table: string) => ({
      select: (cols: string) => query(table, cols),
      upsert: async (rows: any) => call('POST', table, rows, 'resolution=merge-duplicates'),
      delete: () => ({ eq: async (col: string, val: any) => call('DELETE', `${table}?${col}=eq.${val}`) }),
    }),
  };
}
