import { useCallback, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, BarChart3, CheckCircle2, Clock3, Radio, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import type { TabId } from '@/lib/types';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface FeedConfig { paperMode: boolean; killSwitch: boolean }
interface Position { is_live: boolean; symbol: string }
interface Audit { id: string; event_type: string; message: string; created_at: string }
interface Snapshot { config: FeedConfig | null; positions: Position[] | null; audit: Audit[] | null; errors: string[]; checkedAt: string }

async function readFeed(path: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-feed/${path}`, {
    signal: AbortSignal.timeout(12_000), cache: 'no-store',
    headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
  });
  if (!response.ok) throw new Error(`${path} is unavailable (HTTP ${response.status}).`);
  return response.json();
}

function clock(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Overview({ operator, onNavigate }: { operator: boolean; onNavigate: (tab: TabId) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const [configResult, positionsResult, auditResult] = await Promise.allSettled([
        readFeed('config'), readFeed('positions'), readFeed('dashboard-data'),
      ]);
      const next: Snapshot = { config: null, positions: null, audit: null, errors: [], checkedAt: new Date().toISOString() };
      const config = configResult.status === 'fulfilled' ? configResult.value as FeedConfig : null;
      if (config && typeof config.paperMode === 'boolean' && typeof config.killSwitch === 'boolean') next.config = config;
      else next.errors.push('Trading configuration could not be verified.');
      const positions = positionsResult.status === 'fulfilled' ? positionsResult.value as { openPositions?: Position[] } : null;
      if (Array.isArray(positions?.openPositions)) next.positions = positions.openPositions;
      else next.errors.push('Recorded positions could not be refreshed.');
      const audit = auditResult.status === 'fulfilled' ? auditResult.value as { audit?: Audit[] } : null;
      if (Array.isArray(audit?.audit)) next.audit = audit.audit;
      else next.errors.push('Scanner activity could not be refreshed.');
      setSnapshot(next);
    } finally { setLoading(false); inFlight.current = false; }
  }, []);
  useVisibilityPolling(refresh, 30_000);

  const scan = snapshot?.audit?.find(event => event.event_type === 'strategy_scan');
  const scanAge = scan ? Date.now() - new Date(scan.created_at).getTime() : Infinity;
  const scannerFresh = Number.isFinite(scanAge) && scanAge >= 0 && scanAge < 120_000;
  const open = snapshot?.positions?.filter(position => position.is_live === true);
  const mode = snapshot?.config ? snapshot.config.killSwitch ? 'Halted' : snapshot.config.paperMode ? 'Paper' : 'Live' : 'Unverified';
  const cards = [
    { icon: Wallet, label: 'Recorded live positions', value: open ? String(open.length) : '—', detail: 'Reconcile against exchange holdings in Live Execution.' },
    { icon: Radio, label: 'Strategy scanner', value: scannerFresh ? 'Reporting' : scan ? 'Stale' : 'Unverified', detail: scan ? `Last scan ${clock(scan.created_at)}` : 'Waiting for a recent scan event.' },
    { icon: Activity, label: 'Trading mode', value: mode, detail: mode === 'Live' ? 'Real-fund mode is configured. Orders still require qualifying signals.' : mode === 'Halted' ? 'The kill switch is active.' : 'Mode is read from the trading service.' },
    { icon: ShieldCheck, label: 'Your access', value: operator ? 'Operator' : 'Viewer', detail: operator ? 'Exchange balances and account controls are available.' : 'Sign in to verify exchange holdings and manage operations.' },
  ];
  return <section className="space-y-6">
    <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950/60 via-zinc-900 to-zinc-950 p-6 sm:p-10">
      <div className="pointer-events-none absolute -right-10 -top-20 h-80 w-80 rounded-full border border-cyan-400/10 bg-cyan-500/5" />
      <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Your revenue workspace</p>
          <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">Every position.<br />Every payment.<br /><span className="text-cyan-300">A clearer picture.</span></h2>
          <p className="mt-5 max-w-lg text-sm leading-6 text-zinc-400">Follow trading activity, reconcile exchange holdings, and manage your paid products from one workspace.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => onNavigate('execution')} className="flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200">Open Live Execution <ArrowRight className="h-4 w-4" /></button>
            <button onClick={() => onNavigate('revenue')} className="min-h-11 rounded-xl border border-zinc-600 px-5 text-sm font-medium text-zinc-200 hover:bg-white/5">Review revenue</button>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold text-zinc-200">Operational snapshot</p><button aria-label="Refresh overview" disabled={loading} onClick={() => void refresh()} className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
          <p className="mt-1 text-xs text-zinc-500">{snapshot ? `Checked ${clock(snapshot.checkedAt)}` : 'Connecting to your services…'}</p>
          <div className="mt-5 space-y-4">
            {[['Position records', snapshot?.positions !== null && snapshot !== null], ['Scanner heartbeat', scannerFresh], ['Trading configuration', Boolean(snapshot?.config)]].map(([label, available]) => <div key={String(label)} className="flex items-center justify-between gap-3 text-sm"><span className="text-zinc-400">{label}</span><span className={`flex items-center gap-1.5 text-xs ${available ? 'text-emerald-300' : 'text-amber-300'}`}>{available ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{available ? 'Available' : 'Unverified'}</span></div>)}
          </div>
          <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-zinc-500">Recorded positions describe the app’s ledger. Exchange balances and filled orders establish what you actually hold.</p>
        </div>
      </div>
    </div>
    {Boolean(snapshot?.errors.length) && <div role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">{snapshot?.errors.join(' ')} Use refresh to try again.</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <div key={card.label} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"><card.icon className="mb-4 h-5 w-5 text-cyan-300" /><p className="text-xs text-zinc-400">{card.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{card.value}</p><p className="mt-3 text-xs leading-5 text-zinc-500">{card.detail}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-3">{[
      { tab: 'signals-pro' as const, icon: Radio, title: 'Signals Pro', text: 'Manage subscriptions and access to paid signals.', action: 'View subscriptions' },
      { tab: 'revenue' as const, icon: BarChart3, title: 'Revenue reporting', text: 'Separate verified P&L, book estimates, and business targets.', action: 'Open reporting' },
      { tab: 'operations' as const, icon: ArrowDownToLine, title: 'Account operations', text: 'Review exchange connectivity, execution controls, and activity.', action: 'Review operations' },
    ].map(item => <button key={item.tab} onClick={() => onNavigate(item.tab)} className="group rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 text-left transition hover:border-cyan-500/40 hover:bg-zinc-900"><item.icon className="h-5 w-5 text-zinc-400 group-hover:text-cyan-300" /><h3 className="mt-4 text-base font-semibold text-zinc-200">{item.title}</h3><p className="mt-2 text-sm leading-6 text-zinc-500">{item.text}</p><span className="mt-5 flex items-center gap-2 text-xs font-semibold text-cyan-300">{item.action}<ArrowRight className="h-3.5 w-3.5" /></span></button>)}</div>
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5"><h3 className="text-sm font-semibold text-zinc-200">Latest strategy activity</h3><p className="mt-3 text-sm leading-6 text-zinc-400">{scan?.message ?? 'No recent strategy scan has been verified.'}</p>{scan && <p className="mt-2 text-xs text-zinc-500">{clock(scan.created_at)} · Strategy service audit log</p>}</div>
  </section>;
}
