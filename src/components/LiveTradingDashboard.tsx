import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Activity, DollarSign, Zap, Target,
  Shield, Clock, BarChart3, Percent, ArrowUpRight, ArrowDownRight,
  Radio, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FACTIONS, TRADING_PAIRS } from '@/lib/constants';
import { fetchOpenPositions, closeAllPositions, runStrategyScan } from '@/lib/engine';
import type { OpenPosition, PaperTrade } from '@/lib/types';

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

async function fetchConfig(): Promise<TradingConfig | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/config`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchLivePrices(): Promise<PriceTick[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/prices`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tickers ?? []).map((t: { symbol: string; price: number; priceChangePercent: number }) => ({
      symbol: t.symbol,
      price: t.price,
      change: t.priceChangePercent,
    }));
  } catch { return []; }
}

async function toggleKillSwitch(action: 'trip' | 'reset'): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/kill-switch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    return res.ok;
  } catch { return false; }
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
  const [scanning, setScanning] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [togglingKill, setTogglingKill] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const equityRef = useRef<EquityPoint[]>([]);

  const fetchData = useCallback(async () => {
    const [pos, hist, cfg, pr] = await Promise.all([
      fetchOpenPositions(),
      supabase.from('paper_trades').select('*').eq('status', 'closed').order('closed_at', { ascending: false }).limit(100),
      fetchConfig(),
      fetchLivePrices(),
    ]);
    setPositions(pos);
    setHistory(hist.data ?? []);
    setConfig(cfg);
    setPrices(pr);

    // Build equity curve from closed trades
    const closed = (hist.data ?? []) as PaperTrade[];
    const sortedClosed = [...closed].sort((a, b) =>
      new Date(a.closed_at ?? a.opened_at).getTime() - new Date(b.closed_at ?? b.opened_at).getTime()
    );
    const startingCapital = cfg?.liveCapital ?? 43;
    let runningCapital = startingCapital;
    const points: EquityPoint[] = [{ time: 'start', capital: startingCapital, pnl: 0 }];
    for (const t of sortedClosed) {
      runningCapital += Number(t.pnl);
      points.push({
        time: t.closed_at ?? t.opened_at,
        capital: runningCapital,
        pnl: Number(t.pnl),
      });
    }
    // Add current open position unrealized P&L
    const unrealized = pos.reduce((s, p) => s + p.unrealized_pnl, 0);
    points.push({
      time: 'now',
      capital: runningCapital + unrealized,
      pnl: unrealized,
    });
    equityRef.current = points;
    setEquityCurve(points);
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 4000);
    return () => clearInterval(id);
  }, [fetchData]);

  const isLive = config?.paperMode === false;
  const killActive = config?.killSwitch === true;
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalRealized = history.reduce((s, t) => s + Number(t.pnl), 0);
  const wins = history.filter(t => Number(t.pnl) >= 0).length;
  const losses = history.filter(t => Number(t.pnl) < 0).length;
  const winRate = history.length > 0 ? (wins / history.length) * 100 : 0;
  const avgWin = wins > 0 ? history.filter(t => Number(t.pnl) >= 0).reduce((s, t) => s + Number(t.pnl), 0) / wins : 0;
  const avgLoss = losses > 0 ? history.filter(t => Number(t.pnl) < 0).reduce((s, t) => s + Number(t.pnl), 0) / losses : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 99 : 0;
  const dailyLossPct = config && config.liveCapital > 0
    ? (config.dailyLossAccumulator / config.liveCapital) * 100 : 0;
  const currentCapital = (config?.liveCapital ?? 0) + totalUnrealized;
  const totalReturn = config?.liveCapital ? ((totalRealized + totalUnrealized) / config.liveCapital) * 100 : 0;

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
    setClosing(true);
    setConfirmClose(false);
    await closeAllPositions();
    await fetchData();
    setClosing(false);
  }

  async function handleScan() {
    setScanning(true);
    await runStrategyScan();
    setLastScan(new Date());
    await fetchData();
    setScanning(false);
  }

  async function handleKillSwitch() {
    setTogglingKill(true);
    setConfirmKill(false);
    await toggleKillSwitch('trip');
    await fetchData();
    setTogglingKill(false);
  }

  async function handleResetKill() {
    setTogglingKill(true);
    await toggleKillSwitch('reset');
    await fetchData();
    setTogglingKill(false);
  }

  // Sort positions by P&L
  const sortedPositions = [...positions].sort((a, b) => b.unrealized_pnl - a.unrealized_pnl);

  // Top movers from price data
  const topMovers = [...prices].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);

  return (
    <section className="space-y-5">
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
          {isLive ? 'LIVE — REAL ORDERS' : 'PAPER MODE'}
        </span>
        {killActive && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 text-[11px] font-bold text-red-400">
            <AlertTriangle className="h-3 w-3" />
            KILL SWITCH ACTIVE
          </span>
        )}
        <span className="text-[11px] text-zinc-600">
          Auto-scan: every 5 min (pg_cron)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-blue-500 disabled:opacity-50"
          >
            <Zap className={`h-3.5 w-3.5 ${scanning ? 'animate-pulse' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
          {positions.length > 0 && (
            confirmClose ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCloseAll}
                  disabled={closing}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {closing ? 'Closing...' : 'Confirm Close All'}
                </button>
                <button onClick={() => setConfirmClose(false)} className="rounded-lg bg-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-600">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClose(true)}
                className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/20"
              >
                Close All
              </button>
            )
          )}
        </div>
      </div>

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

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Equity */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Equity</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            ${currentCapital.toFixed(2)}
          </p>
          <p className={`font-mono text-[10px] tabular-nums ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}% all-time
          </p>
        </div>

        {/* Unrealized P&L */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Unrealized</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(4)}
          </p>
          <p className="text-[10px] text-zinc-600">{positions.length} open position{positions.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Realized P&L */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Realized</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRealized >= 0 ? '+' : ''}${totalRealized.toFixed(4)}
          </p>
          <p className="text-[10px] text-zinc-600">{history.length} closed trade{history.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Win Rate */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Percent className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Win Rate</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {winRate.toFixed(1)}%
          </p>
          <p className="text-[10px] text-zinc-600">{wins}W / {losses}L</p>
        </div>

        {/* Profit Factor */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target className="h-3.5 w-3.5 text-violet-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Profit Factor</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {profitFactor >= 99 ? '∞' : profitFactor.toFixed(2)}
          </p>
          <p className="text-[10px] text-zinc-600">
            Avg win ${avgWin.toFixed(4)} / Avg loss ${avgLoss.toFixed(4)}
          </p>
        </div>

        {/* Daily Loss */}
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Shield className="h-3.5 w-3.5 text-red-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Daily Loss</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${dailyLossPct >= (config?.maxDailyLossPct ?? 8) * 0.8 ? 'text-red-400' : 'text-zinc-100'}`}>
            {dailyLossPct.toFixed(1)}%
          </p>
          <div className="mt-1.5 h-1 w-full rounded-full bg-zinc-800">
            <div
              className={`h-1 rounded-full transition-all ${dailyLossPct >= (config?.maxDailyLossPct ?? 8) * 0.8 ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(dailyLossPct / (config?.maxDailyLossPct ?? 8) * 100, 100)}%` }}
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
              <h3 className="text-sm font-semibold text-zinc-300">Equity Curve</h3>
            </div>
            <span className={`font-mono text-xs font-bold tabular-nums ${equityUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {equityUp ? '+' : ''}{(equityCurve.length >= 2 ? equityCurve[equityCurve.length - 1].capital - equityCurve[0].capital : 0).toFixed(4)}
            </span>
          </div>
          {equityCurve.length >= 2 ? (
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
              Equity curve builds as trades close
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
              <p className="text-center text-xs text-zinc-600 py-4">Loading market data...</p>
            )}
          </div>
        </div>
      </div>

      {/* Open Positions — Premium Layout */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-300">Active Positions</h3>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-400">{positions.length}</span>
        </div>

        {positions.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-zinc-600">No open positions. The bot will open trades automatically on the next scan.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedPositions.map(p => {
              const meta = FACTIONS.find(f => f.id === p.faction_id);
              const isLong = p.side === 'long';
              const pnlPositive = p.unrealized_pnl >= 0;
              const pnlPct = p.pnl_pct ?? 0;
              const entry = Number(p.entry_price);
              const current = p.current_price ?? entry;
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
              const progressToTP = distToTP > 0 ? Math.max(0, Math.min(100, (pnlPct / distToTP) * 100)) : 0;

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
                      {pnlPositive ? '+' : ''}{p.unrealized_pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                    </span>
                    <span className={`font-mono text-xs font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
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
                        style={{ width: `${pnlPositive ? 50 + progressToTP / 2 : 50 - Math.min(50, Math.abs(pnlPct) / distToSL * 50)}%` }}
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
                      <span className="font-mono tabular-nums text-zinc-400">${current.toFixed(2)}</span>
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
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-400">50% SOLD</span>
                        <span className="font-mono tabular-nums text-amber-400/70">+${partialPnl.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

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
          {history.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-600">No closed trades yet</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {history.slice(0, 20).map(t => {
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
            <p className="text-[10px] text-zinc-600">Immediately halts all trading and force-closes positions</p>
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
                {togglingKill ? 'Tripping...' : 'Confirm Halt'}
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
          <h3 className="text-xs font-semibold text-zinc-400">Scanning {TRADING_PAIRS.length} Pairs</h3>
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
