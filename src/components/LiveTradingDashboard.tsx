import { useState, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Activity, DollarSign, Zap, Target,
  Shield, Clock, BarChart3, Percent, ArrowUpRight, ArrowDownRight,
  Radio, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { FACTIONS, TRADING_PAIRS } from '@/lib/constants';
import { operatorFetch } from '@/lib/operatorAuth';
import { fetchOpenPositions, closeAllPositions, fetchLivePrices } from '@/lib/engine';
import type { OpenPosition, PaperTrade } from '@/lib/types';
import TradingOracle from '@/components/TradingOracle';
import { describeClosePositions, positionUnrealizedPnl, totalPositionPnl, recordedTradeStats, readTradingResponse } from '@/lib/tradingStatus';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface TradingConfig {
  paperMode: boolean;
  killSwitch: boolean;
  killSwitchReason: string | null;
  maxDailyLossPct: number;
  minWinRateThreshold: number;
  liveCapital: number;
  dailyLossAccumulator: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositionPct: number;
  strategyWinRates: Record<string, { winRate: number; totalTrades: number }>;
}

interface EquityPoint {
  time: string;
  capital: number;
  pnl: number;
}

interface PriceTick {
  symbol: string;
  price: number;
  change: number;
}

async function fetchConfig(): Promise<TradingConfig> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/config`, {
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    signal: AbortSignal.timeout(15000),
  });
  const data = await readTradingResponse(res);
  if (typeof data.paperMode !== 'boolean' || typeof data.killSwitch !== 'boolean') {
    throw new Error('Trading configuration is unavailable.');
  }
  return data as unknown as TradingConfig;
}

async function toggleKillSwitch(action: 'trip' | 'reset'): Promise<void> {
  const res = await operatorFetch('binance-feed/kill-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  await readTradingResponse(res);
}

const strategyColors: Record<string, string> = {
  rsi_oversold: '#10b981',
  rsi_overbought: '#ef4444',
  macd_crossover: '#3b82f6',
  momentum_breakout: '#f59e0b',
  mean_reversion: '#06b6d4',
  confluence_long: '#8b5cf6',
  confluence_short: '#ec4899',
};

export default function LiveTradingDashboard() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [history, setHistory] = useState<PaperTrade[]>([]);
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [prices, setPrices] = useState<PriceTick[]>([]);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [togglingKill, setTogglingKill] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [positionsError, setPositionsError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [marketError, setMarketError] = useState('');
  const [configError, setConfigError] = useState('');
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [factionFilter, setFactionFilter] = useState<string>('all');
  const fetchData = useCallback(async () => {
    const [pos, hist, cfg, pr] = await Promise.allSettled([
      fetchOpenPositions(),
      (async () => {
        if (!hasDatabaseAccess) throw new Error('Sign-in configuration is required to read trade history.');
        const result = await supabase.from('paper_trades').select('*').eq('is_live', true).eq('status', 'closed').order('closed_at', { ascending: false }).limit(100);
        if (result.error) throw new Error(result.error.message);
        return (result.data ?? []) as PaperTrade[];
      })(),
      fetchConfig(),
      fetchLivePrices(),
    ]);
    const reason = (cause: unknown) => cause instanceof Error ? cause.message : 'Connection unavailable.';
    if (pos.status === 'fulfilled') {
      setPositions(pos.value); setPositionsLoaded(true); setPositionsError('');
      setRefreshedAt(new Date().toISOString());
    } else setPositionsError(reason(pos.reason));
    if (hist.status === 'fulfilled') {
      setHistory(hist.value); setHistoryLoaded(true); setHistoryError('');
      // This is recorded trade P&L for the fetched window, not account equity.
      let cumulativePnl = 0;
      const points: EquityPoint[] = [{ time: 'start', capital: 0, pnl: 0 }];
      for (const trade of [...hist.value].reverse()) {
        cumulativePnl += Number(trade.pnl);
        points.push({ time: trade.closed_at ?? trade.opened_at, capital: cumulativePnl, pnl: Number(trade.pnl) });
      }
      setEquityCurve(points);
    } else setHistoryError(reason(hist.reason));
    if (cfg.status === 'fulfilled') { setConfig(cfg.value); setConfigError(''); }
    else { setConfig(null); setConfigError(reason(cfg.reason)); }
    if (pr.status === 'fulfilled') { setPrices(pr.value); setMarketError(''); }
    else { setPrices([]); setMarketError(reason(pr.reason)); }
  }, []);

  useVisibilityPolling(fetchData, 10_000);

  const positionsAvailable = positionsLoaded && !positionsError;
  const historyAvailable = historyLoaded && !historyError;
  const dataErrors = [positionsError, historyError, configError, marketError].filter(Boolean);
  const isLive = config?.paperMode === false;
  const killActive = config?.killSwitch === true;
  const totalUnrealized = positionsAvailable ? totalPositionPnl(positions) : null;
  const recorded = recordedTradeStats(history);
  const totalRealized = recorded.total;
  const { wins, losses, winRate, avgWin, avgLoss, profitFactor } = recorded;
  const dailyLossPct = config && config.liveCapital > 0
    ? (config.dailyLossAccumulator / config.liveCapital) * 100 : null;
  const currentCapital = config?.liveCapital ?? null;

  // Sparkline path for equity curve
  const sparkPath = (() => {
    if (equityCurve.length < 2) return '';
    const w = 100;
    const h = 30;
    const caps = equityCurve.map(p => p.capital);
    const min = Math.min(...caps);
    const max = Math.max(...caps);
    const range = max - min || 1;
    return equityCurve.map((p, i) => {
      const x = (i / (equityCurve.length - 1)) * w;
      const y = h - ((p.capital - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  })();

  const equityUp = equityCurve.length >= 2 && equityCurve[equityCurve.length - 1].capital >= equityCurve[0].capital;

  async function handleCloseAll() {
    setClosing(true); setConfirmClose(false); setActionError(''); setActionMessage('');
    try {
      const result = await closeAllPositions();
      const message = describeClosePositions(result);
      if (result.complete) setActionMessage(message); else setActionError(message);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Close status could not be confirmed. Verify exchange orders before retrying.');
    } finally {
      await fetchData(); setClosing(false);
    }
  }

  async function changeKillSwitch(action: 'trip' | 'reset') {
    setTogglingKill(true); setConfirmKill(false); setActionError(''); setActionMessage('');
    try {
      await toggleKillSwitch(action);
      setActionMessage(action === 'trip' ? 'Kill switch activated. Review any remaining positions before considering them closed.' : 'Kill switch reset. Automated trading may resume.');
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Kill switch status could not be confirmed.'); }
    finally { await fetchData(); setTogglingKill(false); }
  }

  const handleKillSwitch = () => changeKillSwitch('trip');
  const handleResetKill = () => {
    if (window.confirm('Reset the kill switch and allow automated trading to resume?')) void changeKillSwitch('reset');
  };

  const sortedPositions = [...positions].sort((a, b) => (positionUnrealizedPnl(b) ?? -Infinity) - (positionUnrealizedPnl(a) ?? -Infinity));
  const visiblePositions = factionFilter === 'all' ? sortedPositions : sortedPositions.filter(p => p.faction_id === factionFilter);
  const visibleHistory = factionFilter === 'all' ? history : history.filter(t => t.faction_id === factionFilter);

  // Top movers from price data
  const topMovers = [...prices].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);

  return (
    <section className="space-y-5">
      <TradingOracle />

      {/* Header Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Radio className="h-5 w-5 text-emerald-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <h2 className="text-lg font-bold text-zinc-100">Live Trading Terminal</h2>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${isLive ? 'bg-red-500/15 text-red-400' : 'bg-cyan-500/15 text-cyan-400'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-red-500' : 'bg-cyan-500'} animate-pulse`} />
          {config ? isLive ? 'LIVE — REAL ORDERS' : 'PAPER MODE' : 'MODE UNAVAILABLE'}
        </span>
        {killActive && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-bold text-red-400">
            <AlertTriangle className="h-3 w-3" />
            KILL SWITCH ACTIVE
          </span>
        )}
        <span className="text-[11px] text-zinc-600">
          {refreshedAt ? `Positions checked ${new Date(refreshedAt).toLocaleTimeString()}` : 'Checking positions…'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {positions.length > 0 && (
            confirmClose ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCloseAll}
                  disabled={closing || togglingKill}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {closing ? 'Closing…' : 'Confirm Close All'}
                </button>
                <button onClick={() => setConfirmClose(false)} className="rounded-lg bg-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-600">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClose(true)}
                disabled={closing || togglingKill}
                className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/20"
              >
                Close All
              </button>
            )
          )}
        </div>
      </div>

      {dataErrors.length > 0 && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">Data unavailable or stale: {dataErrors.join(' ')} Previous rows may remain visible.</div>}
      {actionError && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{actionError}</div>}
      {actionMessage && <div role="status" className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-300">{actionMessage}</div>}
      {positionsAvailable && totalUnrealized === null && <p role="status" className="text-sm text-amber-300">Some position quotes are unavailable. Open P&amp;L is withheld until prices recover.</p>}

      {/* Kill Switch Banner */}
      {killActive && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 animate-slide-in">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-400">TRADING HALTED</p>
              <p className="text-[11px] text-red-400/70">{config?.killSwitchReason ?? 'Manually tripped'}</p>
            </div>
            <button
              onClick={handleResetKill}
              disabled={togglingKill}
              className="flex items-center gap-1 rounded-lg bg-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
            >
              Reset & Resume
            </button>
          </div>
        </div>
      )}

      {/* Underfunded Banner — engine capital below exchange minimum order size */}
      {isLive && !killActive && config !== null && config.liveCapital < 5.5 && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 animate-slide-in">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-400" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-400">TRACKED CAPITAL IS LOW</p>
              <p className="text-[11px] text-amber-400/80">
                The app records {config.liveCapital.toFixed(2)} USDT of trading capital. Confirm the current exchange balance and each pair’s order minimum in Live Execution before adding funds or trading.
              </p>
            </div>
            <DollarSign className="h-4 w-4 flex-shrink-0 text-amber-400/60" />
          </div>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Equity */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Tracked capital</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {currentCapital === null ? '—' : `$${currentCapital.toFixed(2)}`}
          </p>
          <p className="text-[10px] text-zinc-500">App record; verify exchange balance</p>
        </div>

        {/* Unrealized P&L */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Unrealized</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${totalUnrealized === null ? 'text-zinc-500' : totalUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalUnrealized === null ? '—' : `${totalUnrealized >= 0 ? '+' : ''}$${totalUnrealized.toFixed(4)}`}
          </p>
          <p className="text-[10px] text-zinc-600">{positionsAvailable ? `${positions.length} tracked open positions` : 'Position count unavailable'}</p>
        </div>

        {/* Realized P&L */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Recorded P&amp;L</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {historyAvailable ? `${totalRealized >= 0 ? '+' : ''}$${totalRealized.toFixed(4)}` : '—'}
          </p>
          <p className="text-[10px] text-zinc-600">{historyAvailable ? `${history.length} latest records; unverified` : 'History unavailable'}</p>
        </div>

        {/* Win Rate */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Percent className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Win Rate</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {historyAvailable && winRate !== null ? `${winRate.toFixed(1)}%` : '—'}
          </p>
          <p className="text-[10px] text-zinc-600">{historyAvailable ? `${wins}W / ${losses}L / ${recorded.breakeven} flat` : '—'}</p>
        </div>

        {/* Profit Factor */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target className="h-3.5 w-3.5 text-violet-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Profit Factor</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {!historyAvailable || profitFactor === null ? '—' : profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}
          </p>
          <p className="text-[10px] text-zinc-600">
            {historyAvailable ? `Avg win $${avgWin.toFixed(4)} / loss $${avgLoss.toFixed(4)}` : 'Awaiting history'}
          </p>
        </div>

        {/* Daily Loss */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Shield className="h-3.5 w-3.5 text-red-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Daily Loss</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${(dailyLossPct ?? 0) >= (config?.maxDailyLossPct ?? 8) * 0.8 ? 'text-red-400' : 'text-zinc-100'}`}>
            {dailyLossPct === null ? '—' : `${dailyLossPct.toFixed(1)}%`}
          </p>
          <div className="mt-1.5 h-1 w-full rounded-full bg-zinc-800">
            <div
              className={`h-1 rounded-full transition-all ${(dailyLossPct ?? 0) >= (config?.maxDailyLossPct ?? 8) * 0.8 ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min((dailyLossPct ?? 0) / (config?.maxDailyLossPct ?? 8) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Equity Curve + Market Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Equity Curve */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className={`h-4 w-4 ${equityUp ? 'text-emerald-400' : 'text-red-400'}`} />
              <h3 className="text-sm font-semibold text-zinc-300">Recorded trade P&amp;L · latest 100</h3>
            </div>
            <span className={`font-mono text-xs font-bold tabular-nums ${equityUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {historyAvailable ? `${equityUp ? '+' : ''}${totalRealized.toFixed(4)}` : '—'}
            </span>
          </div>
          {historyAvailable && equityCurve.length >= 2 ? (
            <div className="relative h-40 w-full">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full">
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={equityUp ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={equityUp ? '#10b981' : '#ef4444'} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${sparkPath} L 100 30 L 0 30 Z`} fill="url(#equityGrad)" />
                <path d={sparkPath} fill="none" stroke={equityUp ? '#10b981' : '#ef4444'} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="absolute bottom-1 left-1 font-mono text-[9px] text-zinc-600">
                ${equityCurve[0]?.capital.toFixed(2)}
              </div>
              <div className="absolute bottom-1 right-1 font-mono text-[9px] text-zinc-600">
                ${equityCurve[equityCurve.length - 1]?.capital.toFixed(2)}
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-zinc-600">
              {historyError || (historyLoaded ? 'No closed trades recorded.' : 'Loading trade records…')}
            </div>
          )}
        </div>

        {/* Market Movers */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Radio className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-300">Top Movers</h3>
          </div>
          <div className="space-y-1.5">
            {topMovers.length > 0 ? topMovers.map(p => (
              <div key={p.symbol} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/40 transition-colors">
                <span className="text-xs font-semibold text-zinc-400 w-12">{p.symbol.replace('USDT', '')}</span>
                <span className="font-mono text-xs tabular-nums text-zinc-300">${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                <span className={`ml-auto flex items-center gap-0.5 font-mono text-xs font-bold tabular-nums ${p.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(p.change).toFixed(2)}%
                </span>
              </div>
            )) : (
              <p className="text-center text-xs text-zinc-600 py-4">{marketError || 'Loading market data…'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Faction Filter */}
      <div className="flex flex-wrap gap-1.5">
        {[{ id: 'all', name: 'All Factions' }, ...FACTIONS.map(f => ({ id: f.id, name: f.name }))].map(opt => {
          const active = factionFilter === opt.id;
          const count = opt.id === 'all' ? positions.length : positions.filter(p => p.faction_id === opt.id).length;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFactionFilter(opt.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {opt.name} <span className="font-mono tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Open Positions — Premium Layout */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-300">Active Positions</h3>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-400">{visiblePositions.length}</span>
        </div>

        {visiblePositions.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-zinc-600">{positionsAvailable ? 'No open positions recorded. Exchange holdings may differ; check Live Execution for reconciliation.' : 'Open positions could not be confirmed.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePositions.map(p => {
              const meta = FACTIONS.find(f => f.id === p.faction_id);
              const isLong = p.side === 'long';
              const pnl = positionUnrealizedPnl(p);
              const pnlPositive = pnl !== null && pnl >= 0;
              const pnlPct = p.current_price !== null && Number(p.entry_price) > 0
                ? ((p.current_price - Number(p.entry_price)) / Number(p.entry_price)) * 100 * (isLong ? 1 : -1) : null;
              const entry = Number(p.entry_price);
              const current = p.current_price;
              const stop = Number(p.stop_loss);
              const target = Number(p.take_profit);
              const liveTrade = (p as OpenPosition & { is_live?: boolean }).is_live;
              const stratColor = strategyColors[p.strategy] ?? '#a1a1aa';
              const peakPrice = (p as OpenPosition & { peak_price?: number }).peak_price;
              const hasPartialExit = (p as OpenPosition & { has_partial_exit?: boolean }).has_partial_exit;
              const partialPnl = (p as OpenPosition & { partial_pnl?: number }).partial_pnl ?? 0;

              // Distance to SL/TP in %
              const distToSL = isLong ? ((entry - stop) / entry) * 100 : ((stop - entry) / entry) * 100;
              const distToTP = isLong ? ((target - entry) / entry) * 100 : ((entry - target) / entry) * 100;
              const progressToTP = pnlPct !== null && distToTP > 0 ? Math.max(0, Math.min(100, (pnlPct / distToTP) * 100)) : 0;

              return (
                <div key={p.id} className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 transition-all hover:border-zinc-700">
                  {/* Accent bar */}
                  <div className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: stratColor }} />

                  {/* Header */}
                  <div className="mb-3 flex items-center gap-2 pl-2">
                    {liveTrade && (
                      <span className="flex items-center gap-0.5 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400">
                        <DollarSign className="h-2.5 w-2.5" />
                        LIVE
                      </span>
                    )}
                    <span className={`flex items-center gap-0.5 text-xs font-bold uppercase ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isLong ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {p.side}
                    </span>
                    <span className="font-mono text-sm font-bold text-zinc-200">{p.symbol}</span>
                    <span className="text-[10px] text-zinc-600">{meta?.name ?? p.faction_id}</span>
                  </div>

                  {/* P&L */}
                  <div className="mb-3 flex items-baseline justify-between pl-2">
                    <span className={`font-mono text-lg font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnl === null ? 'Quote unavailable' : `${pnlPositive ? '+' : ''}${pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}`}
                    </span>
                    <span className={`font-mono text-xs font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnlPct === null ? '—' : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
                    </span>
                  </div>

                  {/* Progress to TP */}
                  <div className="mb-3 pl-2">
                    <div className="mb-1 flex items-center justify-between text-[9px] text-zinc-600">
                      <span>SL ${stop.toFixed(2)}</span>
                      <span>TP ${target.toFixed(2)}</span>
                    </div>
                    <div className="relative h-1.5 w-full rounded-full bg-zinc-800">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-600" />
                      <div
                        className={`h-1.5 rounded-full transition-all ${pnlPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${pnlPct === null ? 0 : pnlPositive ? 50 + progressToTP / 2 : 50 - Math.min(50, Math.abs(pnlPct) / Math.max(distToSL, 0.001) * 50)}%` }}
                      />
                    </div>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-1 pl-2 text-[10px]">
                    <div className="flex items-center gap-1 text-zinc-600">
                      <span>Entry:</span>
                      <span className="font-mono tabular-nums text-zinc-400">${entry.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-600">
                      <span>Current:</span>
                      <span className="font-mono tabular-nums text-zinc-400">{current === null ? '—' : `$${current.toFixed(4)}`}</span>
                    </div>
                    {peakPrice && Number(peakPrice) > 0 && (
                      <div className="flex items-center gap-1 text-zinc-600">
                        <TrendingUp className="h-2.5 w-2.5 text-emerald-500" />
                        <span className="font-mono tabular-nums text-emerald-400/70">${Number(peakPrice).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-zinc-600">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{Math.round((Date.now() - new Date(p.opened_at).getTime()) / 60000)}m ago</span>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-600">
                      <DollarSign className="h-2.5 w-2.5" />
                      <span>${Number(p.position_value).toFixed(2)}</span>
                    </div>
                    {hasPartialExit && (
                      <div className="flex items-center gap-1 text-zinc-600">
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-400">PARTIAL EXIT</span>
                        <span className="font-mono tabular-nums text-amber-400/70">+${partialPnl.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  {p.execution_error && <p role="alert" className="mt-3 pl-2 text-xs text-amber-300">Close needs attention: {p.execution_error}</p>}
                  {/* Strategy tag */}
                  <div className="mt-2 flex items-center gap-1 pl-2">
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ backgroundColor: `${stratColor}20`, color: stratColor }}>
                      {p.strategy.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Strategy Performance + Trade History */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Strategy Win Rates */}
        {config?.strategyWinRates && Object.keys(config.strategyWinRates).length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-zinc-300">Strategy Performance</h3>
              <span className="ml-auto text-[10px] text-zinc-600">Min {config.minWinRateThreshold}% to trade</span>
            </div>
            <div className="space-y-2">
              {Object.entries(config.strategyWinRates).map(([strategy, stats]) => {
                const eligible = stats.totalTrades < 5 || stats.winRate >= config.minWinRateThreshold;
                const color = strategyColors[strategy] ?? '#a1a1aa';
                return (
                  <div key={strategy} className={`rounded-lg p-2.5 ${eligible ? 'bg-zinc-950/40' : 'bg-zinc-950/40 opacity-50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color }}>{strategy.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-sm font-bold tabular-nums text-zinc-200">
                        {stats.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-full bg-zinc-800">
                        <div className="h-1 rounded-full" style={{ width: `${Math.min(stats.winRate, 100)}%`, backgroundColor: color }} />
                      </div>
                      <span className="text-[9px] text-zinc-600">{stats.totalTrades} trades {eligible ? '' : '— BLOCKED'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Trade History */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-300">Recent Trades</h3>
          </div>
          {visibleHistory.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-600">{historyAvailable ? 'No closed trades recorded' : 'Trade history unavailable'}</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {visibleHistory.slice(0, 20).map(t => {
                const isWin = Number(t.pnl) >= 0;
                const pnl = Number(t.pnl);
                const liveTrade = (t as PaperTrade & { is_live?: boolean }).is_live;
                return (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/40 transition-colors">
                    {liveTrade && <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-bold text-red-400">LIVE</span>}
                    <ChevronRight className={`h-3 w-3 ${isWin ? 'text-emerald-400' : 'text-red-400'}`} />
                    <span className={`font-bold uppercase ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side}</span>
                    <span className="font-mono text-zinc-300">{t.symbol}</span>
                    <span className="font-mono tabular-nums text-zinc-600 text-[10px]">
                      ${Number(t.entry_price).toFixed(2)} → ${Number(t.exit_price ?? 0).toFixed(2)}
                    </span>
                    <span className={`ml-auto font-mono font-bold tabular-nums ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isWin ? '+' : ''}{pnl.toFixed(4)}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600">
                      {t.closed_at ? new Date(t.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Kill Switch Control */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-red-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-300">Emergency Kill Switch</p>
            <p className="text-[10px] text-zinc-600">Halts new trading. Position exits depend on the worker; verify remaining holdings in Live Execution.</p>
          </div>
          {killActive ? (
            <button
              onClick={handleResetKill}
              disabled={togglingKill}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              Reset & Resume Trading
            </button>
          ) : confirmKill ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleKillSwitch}
                disabled={togglingKill}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {togglingKill ? 'Tripping…' : 'Confirm Halt'}
              </button>
              <button onClick={() => setConfirmKill(false)} className="rounded-lg bg-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-600">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmKill(true)}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/20"
            >
              Halt All Trading
            </button>
          )}
        </div>
      </div>

      {/* Trading Pairs Coverage */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Radio className="h-4 w-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-zinc-400">Configured coverage: {TRADING_PAIRS.length} pairs</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRADING_PAIRS.map(pair => {
            const hasPosition = positions.some(p => p.symbol === pair);
            const price = prices.find(p => p.symbol === pair);
            return (
              <span
                key={pair}
                className={`rounded-md px-2 py-1 text-[10px] font-mono font-semibold transition-all ${
                  hasPosition
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : price
                    ? 'bg-zinc-800/60 text-zinc-400'
                    : 'bg-zinc-900/40 text-zinc-600'
                }`}
              >
                {pair.replace('USDT', '')}
                {hasPosition && ' ●'}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
