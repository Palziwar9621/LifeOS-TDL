// LifeOS — auth wrapper with human-readable error handling
import type { Session, User } from '@supabase/supabase-js';
import { getClient } from './supabase';

export async function getSession(): Promise<Session | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const sb = getClient();
  if (!sb) { cb(null); return () => {}; }
  const { data } = sb.auth.onAuthStateChange((_evt, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export interface AuthResult { ok: boolean; error?: string; needsEmailConfirm?: boolean; }

function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the confirmation link.';
  if (m.includes('invalid login credentials')) return 'Wrong email or password. Please try again.';
  if (m.includes('rate limit')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('signup requires a valid password')) return 'Please choose a valid password (at least 6 characters).';
  if (m.includes('password should be at least')) return 'That password is too short — use at least 6 characters.';
  if (m.includes('user already registered') || m.includes('already been registered')) return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'That email address doesn\'t look valid.';
  if (m.includes('fetch') || m.includes('network')) return 'Can\'t reach the server. Check your internet connection and that your Supabase URL is correct.';
  if (m.includes('failed to fetch')) return 'Can\'t reach the server. Check the Supabase URL on the setup screen.';
  if (m.includes('email address') && m.includes('invalid')) return 'That email address doesn\'t look valid.';
  if (m.includes('otp') || m.includes('otp_disabled') || m.includes('email logins are disabled') || m.includes('signups not allowed')) {
    return 'Email sign-in is disabled on this Supabase project. Open Supabase → Authentication → Providers → Email and enable it.';
  }
  if (m.includes('smtp') || m.includes('sending')) {
    return 'The server could not send email. In Supabase → Authentication, enable "Confirm email" OFF for testing, or configure SMTP.';
  }
  return msg;
}

export async function signUp(email: string, password: string, username: string): Promise<AuthResult> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Connect to Supabase first (setup screen).' };
  try {
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { username: username.trim() } },
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    // If email confirmation is ON, session is null until user confirms.
    if (!data.session) return { ok: true, needsEmailConfirm: true };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(String(e?.message ?? e)) };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Connect to Supabase first (setup screen).' };
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(String(e?.message ?? e)) };
  }
}

export async function signOut(): Promise<void> {
  const sb = getClient();
  if (sb) await sb.auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Connect to Supabase first (setup screen).' };
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email.trim());
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(String(e?.message ?? e)) };
  }
}

export async function updateUserPassword(newPassword: string): Promise<AuthResult> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Not connected.' };
  try {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyAuthError(String(e?.message ?? e)) };
  }
}

export async function currentUser(): Promise<User | null> {
  const s = await getSession();
  return s?.user ?? null;
}
