// LifeOS — auth & setup screens
import React, { useState } from 'react';
import { Logo, Icon } from '../ui/components';
import { setSupabaseConfig, loadSupabaseConfig } from '../lib/supabase';
import { signUp, signIn, sendPasswordReset } from '../lib/auth';
import { useApp } from './store';

export function SetupScreen({ onConfigured }: { onConfigured: () => void }) {
  const [url, setUrl] = useState(loadSupabaseConfig()?.url ?? '');
  const [key, setKey] = useState(loadSupabaseConfig()?.anonKey ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const test = async () => {
    setBusy(true); setErr('');
    try {
      const u = url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/.+/.test(u)) throw new Error('URL must start with https:// (e.g. https://xyz.supabase.co)');
      if (!key.trim()) throw new Error('Paste your anon/public key');
      const res = await fetch(`${u}/auth/v1/health`, { headers: { apikey: key.trim() } });
      if (!res.ok) throw new Error('Could not reach Supabase — check the URL and key.');
      setSupabaseConfig({ url: u, anonKey: key.trim() });
      onConfigured();
    } catch (e: any) {
      setErr(e?.message ?? 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Logo size={32} />
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight">Welcome to LifeOS</h1>
      <p className="mt-1 text-sm muted">Connect your private Supabase backend to sync across all your devices.</p>

      <div className="mt-6 space-y-3 text-left">
        <div>
          <label className="label">Supabase project URL</label>
          <input className="input" placeholder="https://xxxxxxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="label">Anon / public key</label>
          <input className="input" placeholder="eyJhbGciOi… (Settings → API → anon key)" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        {err && <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</p>}
        <button className="btn-primary w-full" onClick={() => void test()} disabled={busy}>
          {busy ? 'Testing connection…' : 'Connect'}
        </button>
      </div>

      <details className="mt-6 text-left text-sm muted">
        <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">How do I get these values? (2 minutes)</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>Create a free project at <span className="font-semibold">supabase.com</span></li>
          <li>Open <b>SQL Editor</b>, paste the contents of <code>supabase/schema.sql</code>, run it.</li>
          <li>Open <b>Project Settings → API</b>: copy the <b>Project URL</b> and the <b>anon public</b> key.</li>
          <li>Enable <b>Realtime</b> for all tables (Database → Replication → enable for your tables, or run the publication SQL in the schema — included).</li>
          <li>In <b>Authentication → Sign In / Up</b>: enable <b>Email</b> provider and turn <b>"Confirm email"</b> <b>off</b> for instant login (or configure SMTP and keep it on).</li>
        </ol>
      </details>

      <p className="mt-6 text-xs muted">
        Your keys stay in this browser/app profile. Supabase anon keys are public client keys — Row Level Security keeps every user's data private.
      </p>
    </AuthLayout>
  );
}


export function AuthScreen() {
  const { toast } = useApp();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'login') {
        const r = await signIn(email, password);
        if (!r.ok) throw new Error(r.error ?? 'Sign in failed');
      } else if (mode === 'signup') {
        const r = await signUp(email, password, username);
        if (!r.ok) throw new Error(r.error ?? 'Sign up failed');
        if (r.needsEmailConfirm) {
          setInfo('Account created! Check your email to confirm, then sign in.');
          setMode('login');
          return;
        }
      } else {
        const r = await sendPasswordReset(email);
        if (!r.ok) throw new Error(r.error ?? 'Could not send reset email');
        setInfo('If an account exists for that email, a reset link is on its way.');
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Logo size={32} />
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
        {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
      </h1>
      <p className="mt-1 text-sm muted">
        {mode === 'login' ? 'Sign in to your LifeOS.' : mode === 'signup' ? 'One account — every device.' : 'We\'ll email you a reset link.'}
      </p>

      <form className="mt-6 space-y-3 text-left" onSubmit={submit}>
        {mode === 'signup' && (
          <div>
            <label className="label">Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="alex" autoComplete="username" required />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </div>
        {mode !== 'forgot' && (
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={6} />
          </div>
        )}
        {err && <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</p>}
        {info && <p className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{info}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>

      <div className="mt-4 text-sm">
        {mode === 'login' && (
          <>
            <button className="text-brand-600 dark:text-brand-300 font-semibold" onClick={() => setMode('signup')}>Create an account</button>
            <span className="mx-2 muted">·</span>
            <button className="muted" onClick={() => setMode('forgot')}>Forgot password?</button>
          </>
        )}
        {mode !== 'login' && (
          <button className="text-brand-600 dark:text-brand-300 font-semibold" onClick={() => setMode('login')}>← Back to sign in</button>
        )}
      </div>
    </AuthLayout>
  );
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-slate-100 to-violet-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 px-4 py-10">
      <div className="card w-full max-w-md p-8 text-center animate-slide-up">
        <div className="flex flex-col items-center">{children}</div>
      </div>
      <p className="fixed bottom-4 inset-x-0 text-center text-xs muted">LifeOS · your life, organized</p>
    </div>
  );
}
