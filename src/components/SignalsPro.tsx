import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Zap, Check, Loader2, Crown, Lock, Unlock, TrendingUp, Radio, ShieldCheck } from 'lucide-react';
import { supabase, hasDatabaseAccess } from '@/lib/supabase';
import { signInWithEmail, signUpWithEmail } from '@/lib/operatorAuth';

interface SubscriptionState {
  status: 'loading' | 'none' | 'active' | 'canceled';
  current_period_end?: number;
}

interface PremiumSignal {
  id: string;
  signal_type: string;
  token_symbol: string;
  payload: { price?: number; confidence?: number; note?: string; faction?: string } | null;
  created_at: string;
}

export default function SignalsPro() {
  const [sub, setSub] = useState<SubscriptionState>({ status: 'loading' });
  const [signals, setSignals] = useState<PremiumSignal[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');

  const loadSubscription = useCallback(async () => {
    if (!hasDatabaseAccess) {
      setSub({ status: 'none' });
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSub({ status: 'none' });
      setNeedsAuth(true);
      return;
    }
    setNeedsAuth(false);
    const { data, error: subError } = await supabase
      .from('stripe_user_subscriptions')
      .select('subscription_status, current_period_end')
      .maybeSingle();
    if (subError) {
      setError('Could not load your subscription state.');
      setSub({ status: 'none' });
      return;
    }
    if (!data) {
      setSub({ status: 'none' });
      return;
    }
    const status = String(data.subscription_status ?? '');
    const active = ['active', 'trialing', 'past_due'].includes(status)
      && Number(data.current_period_end ?? 0) * 1000 > Date.now();
    setSub({
      status: active ? 'active' : 'canceled',
      current_period_end: Number(data.current_period_end ?? 0),
    });
  }, []);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const fetchSignals = useCallback(async () => {
    setLoadingSignals(true);
    try {
      const { data, error: sigError } = await supabase
        .from('signals')
        .select('id, signal_type, token_symbol, payload, created_at')
        .in('signal_type', ['whale', 'smart_money'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (sigError) throw new Error(sigError.message);
      setSignals((data ?? []) as PremiumSignal[]);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Signals unavailable.');
    } finally {
      setLoadingSignals(false);
    }
  }, []);

  useEffect(() => {
    if (sub.status === 'active') void fetchSignals();
  }, [sub.status, fetchSignals]);

  async function handleSubscribe() {
    setBuying(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionData.session) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      const origin = `${window.location.origin}${window.location.pathname}`;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-subscription-checkout`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tier: 'pro',
            success_url: `${origin}#signals-pro`,
            cancel_url: `${origin}#signals-pro`,
          }),
        },
      );
      const body: { url?: string; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error ?? 'Checkout could not start.');
      window.location.href = body.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not start.');
      setBuying(false);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setAuthNotice('');
    if (!authEmail.trim() || authPassword.length < 6) {
      setAuthError('Enter your email and a password of at least 6 characters.');
      return;
    }
    setAuthBusy(true);
    try {
      if (authMode === 'sign-in') {
        await signInWithEmail(authEmail.trim(), authPassword);
      } else {
        await signUpWithEmail(authEmail.trim(), authPassword);
        setAuthNotice('Account created. You can now subscribe.');
      }
      setAuthPassword('');
      await loadSubscription();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
    } finally {
      setAuthBusy(false);
    }
  }

  const authForm = (
    <form onSubmit={handleAuth} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
        {(['sign-up', 'sign-in'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => { setAuthMode(option); setAuthError(''); setAuthNotice(''); }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              authMode === option ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {option === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-400">Email</span>
        <input
          type="email"
          autoComplete="email"
          value={authEmail}
          onChange={e => setAuthEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-400">Password</span>
        <input
          type="password"
          autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
          value={authPassword}
          onChange={e => setAuthPassword(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
          minLength={6}
          required
        />
      </label>
      {authError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{authError}</p>}
      {authNotice && <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" />{authNotice}</p>}
      <button
        type="submit"
        disabled={authBusy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
      >
        {authBusy && <Loader2 className="h-4 w-4 animate-spin" />}
        {authMode === 'sign-up' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );

  const isActive = sub.status === 'active';

  return (
    <section className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Radio className="h-6 w-6 text-cyan-400" />
              <h2 className="text-xl font-bold text-zinc-100">Signals Pro</h2>
              <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-400">
                SUBSCRIPTION
              </span>
            </div>
            <p className="max-w-2xl text-sm text-zinc-400">
              Whale and smart-money signal streams, delivered the moment the swarm sees them.
              Public feeds show entries and exits; Pro adds the rest.
            </p>
          </div>
          {isActive ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              <div className="flex items-center gap-2 font-bold"><Unlock className="h-4 w-4" /> Pro active</div>
              <p className="mt-1 text-xs text-emerald-400/80">
                Renews {sub.current_period_end ? new Date(sub.current_period_end * 1000).toLocaleDateString() : '—'}
              </p>
            </div>
          ) : (
            <button
              onClick={() => void handleSubscribe()}
              disabled={buying}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {buying ? 'Opening checkout…' : 'Subscribe — $29/mo'}
            </button>
          )}
        </div>
      </div>

      {needsAuth && !isActive && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="flex items-center gap-2 text-sm text-amber-300">
            <Lock className="h-4 w-4" /> Create a free account to subscribe — access is tied to your login.
          </p>
          {authForm}
        </div>
      )}

      {isActive ? (
        loadingSignals ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
          </div>
        ) : (
          <div className="space-y-2">
            {signals.length === 0 && (
              <p className="text-sm text-zinc-500">No premium signals yet — the swarm is watching.</p>
            )}
            {signals.map(sig => (
              <div key={sig.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                    {sig.signal_type === 'whale'
                      ? <Crown className="h-4 w-4 text-amber-400" />
                      : <TrendingUp className="h-4 w-4 text-emerald-400" />}
                    {sig.signal_type.toUpperCase()} · {sig.token_symbol}
                  </span>
                  <span className="text-xs text-zinc-600">{new Date(sig.created_at).toLocaleTimeString()}</span>
                </div>
                {sig.payload?.note && <p className="mt-1 text-xs text-zinc-400">{sig.payload.note}</p>}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Lock className="h-4 w-4 text-cyan-400" /> What Pro unlocks
          </p>
          <ul className="mt-3 space-y-2">
            {['Whale wallet movements in real time', 'Smart-money flow alerts', 'Full signal payload detail'].map(feature => (
              <li key={feature} className="flex items-center gap-2 text-sm text-zinc-400">
                <Check className="h-4 w-4 text-cyan-400" /> {feature}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
