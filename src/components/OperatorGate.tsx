import { useState, type FormEvent, type ReactNode } from 'react';
import { Lock, ShieldCheck, Loader2 } from 'lucide-react';
import type { OperatorStatus } from '@/lib/useOperatorSession';
import { signInWithEmail, signUpWithEmail, signOutOperator } from '@/lib/operatorAuth';

interface Props {
  status: OperatorStatus;
  children: ReactNode;
}

type Mode = 'sign-in' | 'sign-up';

const inputClass = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

export default function OperatorGate({ status, children }: Props) {
  if (status === 'operator') return <>{children}</>;
  if (status === 'loading') {
    return (
      <div className="flex justify-center py-24 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return <OperatorLoginCard signedIn={status === 'signed-in'} />;
}

function OperatorLoginCard({ signedIn }: { signedIn: boolean }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
        setNotice('Account created. Ask the owner to grant operator access before using trading controls.');
      }
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setError('');
    try {
      await signOutOperator();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-out failed.');
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl shadow-black/30">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Operator access required</h2>
          <p className="text-xs text-zinc-500">Withdrawals and trading controls are restricted to the operator.</p>
        </div>
      </div>

      {signedIn ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            You are signed in, but this account does not have operator access.
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Sign out
          </button>
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
            {(['sign-in', 'sign-up'] as const).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => { setMode(option); setError(''); setNotice(''); }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === option ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {option === 'sign-in' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
              required
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Password</span>
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={inputClass}
              minLength={6}
              required
            />
          </label>

          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {notice && <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" />{notice}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
}
