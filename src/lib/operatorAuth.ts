import { hasDatabaseAccess, supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!hasDatabaseAccess) throw new Error('Sign-in is not configured for this deployment. Contact the app owner.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  if (!hasDatabaseAccess) throw new Error('Account registration is not configured for this deployment. Contact the app owner.');
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOutOperator(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function checkIsOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_operator');
  if (error) throw new Error(error.message);
  return data === true;
}

export async function operatorFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!hasDatabaseAccess) throw new Error('Operator access is not configured for this deployment.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in with an operator account to continue.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('apikey', ANON_KEY);
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
}
