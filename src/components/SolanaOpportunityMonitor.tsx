import { useCallback, useState } from 'react';
import { Activity, AlertTriangle, ArrowRightLeft, Radio, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

const STATUS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/solana-monitor/status`;

type EngineState = 'monitoring' | 'quote_live' | 'armed' | 'configuration_required' | 'unavailable';

type YieldPool = {
  pool: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
};

type MonitorEvent = {
  signature: string;
  wallet: string;
  token_mint: string | null;
  usdc_amount: number;
  status: string;
  forwarded: boolean;
  created_at: string;
};

type MonitorStatus = {
  mode: string;
  refreshedAt: string;
  configuration: {
    smartWalletCount: number;
    liquidityPoolCount: number;
    smartMoneyReady: boolean;
    arbitrageReady: boolean;
    chronosReady: boolean;
    jupiterMode: string;
    signerConnected: boolean;
    executionAuthorized: boolean;
    limits: { minCopyUsdc: number; maxCopyUsdc: number; maxPriceImpactBps: number; minYieldTvl: number; minPoolImpactUsdc: number };
  };
  engines: {
    smartMoney: EngineState;
    arbitrage: EngineState;
    yield: EngineState;
    chronos: EngineState;
  };
  jupiterQuote: {
    input: string;
    outAmount: string | null;
    router: string | null;
    feeBps: number | null;
    priceImpactPct: string | number | null;
  } | null;
  yieldMonitor: {
    source: string;
    refreshedAt: string | null;
    pools: YieldPool[];
    topOpportunity: (YieldPool & { spreadToNextBps: number | null }) | null;
  };
  recentEvents: MonitorEvent[];
  errors: { quote: string | null; yield: string | null; events: string | null };
};

function enginePresentation(state: EngineState) {
  if (state === 'monitoring' || state === 'quote_live' || state === 'armed') {
    return { label: state.replace('_', ' ').toUpperCase(), className: 'bg-emerald-500/15 text-emerald-400' };
  }
  if (state === 'configuration_required') {
    return { label: 'SETUP REQUIRED', className: 'bg-amber-500/15 text-amber-300' };
  }
  return { label: 'UNAVAILABLE', className: 'bg-red-500/15 text-red-300' };
}

function compact(value: string | null | undefined, length = 6) {
  if (!value) return '—';
  return value.length > length * 2 ? `${value.slice(0, length)}…${value.slice(-length)}` : value;
}

export default function SolanaOpportunityMonitor() {
  const [data, setData] = useState<MonitorStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetch(STATUS_URL, {
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });
      const body = await result.json() as MonitorStatus & { error?: string };
      if (!result.ok) throw new Error(body.error || `Solana monitor returned HTTP ${result.status}.`);
      setData(body);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Solana opportunity monitor is unavailable.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useVisibilityPolling(refresh, 30_000);

  const engines = data ? [
    { name: 'Smart Money', detail: `${data.configuration.smartWalletCount} curated wallets`, state: data.engines.smartMoney, icon: Radio },
    { name: 'Pool-Impact Feed', detail: `${data.configuration.liquidityPoolCount} Raydium/Orca pools`, state: data.engines.arbitrage, icon: ArrowRightLeft },
    { name: 'Yield Rebalancer', detail: `${data.yieldMonitor.pools.length} qualified USDC pools`, state: data.engines.yield, icon: TrendingUp },
    { name: 'Chronos Router', detail: data.configuration.chronosReady ? 'Authenticated signal route' : 'Webhook secret missing', state: data.engines.chronos, icon: Activity },
  ] : [];
  const topYield = data?.yieldMonitor.topOpportunity;
  const engineErrors = data ? Object.values(data.errors).filter(Boolean) : [];

  return (
    <section className="space-y-4 rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/5 via-zinc-950 to-cyan-500/5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-purple-400" />
        <div>
          <h3 className="font-bold text-zinc-100">Solana Opportunity Monitor</h3>
          <p className="text-xs text-zinc-500">Verified signals only · no unattended signing</p>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing} className="ml-auto rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
          <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}
      {engineErrors.length > 0 && <div role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">{engineErrors.join(' · ')}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {engines.map(engine => {
          const presentation = enginePresentation(engine.state);
          return <div key={engine.name} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><engine.icon className="h-4 w-4 text-cyan-400" /><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${presentation.className}`}>{presentation.label}</span></div>
            <p className="text-sm font-bold text-zinc-200">{engine.name}</p>
            <p className="mt-1 text-[11px] text-zinc-500">{engine.detail}</p>
          </div>;
        })}
      </div>

      {data && <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Jupiter route check</p>
          <p className="mt-2 text-sm font-semibold text-zinc-200">{data.jupiterQuote ? `${data.jupiterQuote.input} → SOL` : 'No live quote'}</p>
          <p className="mt-1 text-xs text-zinc-500">Router {data.jupiterQuote?.router ?? '—'} · fee {data.jupiterQuote?.feeBps ?? '—'} bps</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Best qualified USDC yield</p>
          <p className="mt-2 font-mono text-xl font-bold text-emerald-400">{topYield ? `${topYield.apy.toFixed(2)}% APY` : '—'}</p>
          <p className="mt-1 text-xs text-zinc-500">{topYield ? `${topYield.project} · $${(topYield.tvlUsd / 1_000_000).toFixed(1)}M TVL` : 'No qualifying pool'}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Copy-trade guard</p>
          <p className="mt-2 text-sm font-semibold text-zinc-200">${data.configuration.limits.minCopyUsdc}–${data.configuration.limits.maxCopyUsdc} per signal</p>
          <p className="mt-1 text-xs text-zinc-500">Max impact {data.configuration.limits.maxPriceImpactBps} bps · signer disabled</p>
        </div>
      </div>}

      {data && !data.configuration.executionAuthorized && <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <span>Signal mode is active. A public EVM address cannot sign Solana swaps; live execution requires a separately secured Solana signer and explicit Chronos authorization.</span>
      </div>}

      {data && data.recentEvents.length > 0 && <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-900/80 text-zinc-500"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Wallet</th><th className="px-3 py-2">Token</th><th className="px-3 py-2">USDC observed</th><th className="px-3 py-2">Route</th></tr></thead>
          <tbody>{data.recentEvents.map(event => <tr key={event.signature} className="border-t border-zinc-800 text-zinc-300"><td className="px-3 py-2">{new Date(event.created_at).toLocaleTimeString()}</td><td className="px-3 py-2 font-mono">{compact(event.wallet)}</td><td className="px-3 py-2 font-mono">{compact(event.token_mint)}</td><td className="px-3 py-2 font-mono">${Number(event.usdc_amount).toFixed(2)}</td><td className="px-3 py-2">{event.forwarded ? 'Chronos' : event.status}</td></tr>)}</tbody>
        </table>
      </div>}

      {data && <p className="text-[10px] text-zinc-600">Yield source: {data.yieldMonitor.source} · refreshed {new Date(data.refreshedAt).toLocaleTimeString()} · opportunities are signals, not guaranteed profit.</p>}
    </section>
  );
}
