import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Zap, Brain, Target, Shield, X, RefreshCw, AlertCircle, Power, Activity, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FACTIONS } from '@/lib/constants';
import { fetchOpenPositions, closeAllPositions } from '@/lib/engine';
import type { OpenPosition, PaperTrade } from '@/lib/types';

const strategyStyles: Record<string, { color: string; bg: string; label: string }> = {
  rsi_oversold: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'RSI Oversold' },
  rsi_overbought: { color: 'text-red-400', bg: 'bg-red-500/15', label: 'RSI Overbought' },
  macd_crossover: { color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'MACD Crossover' },
  momentum_breakout: { color: 'text-amber-400', bg: 'bg-amber-500/15', label: 'Momentum' },
  mean_reversion: { color: 'text-cyan-400', bg: 'bg-cyan-500/15', label: 'Mean Reversion' },
};

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
  strategyWinRates: Record<string, { winRate: number; totalTrades: number }>;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function fetchConfig(): Promise<TradingConfig | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/config`, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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

async function togglePaperMode(paperMode: boolean): Promise<boolean> {
  const { error } = await supabase.from('strategy_config').update({ paper_mode: paperMode }).eq('id', 1);
  return !error;
}

export default function PaperTradingPanel() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [history, setHistory] = useState<PaperTrade[]>([]);
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);
  const [togglingKill, setTogglingKill] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [pos, hist, cfg] = await Promise.all([
      fetchOpenPositions(),
      supabase.from('paper_trades').select('*').eq('status', 'closed').order('closed_at', { ascending: false }).limit(20),
      fetchConfig(),
    ]);
    setPositions(pos);
    setHistory(hist.data ?? []);
    setConfig(cfg);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  const totalUnrealizedPnl = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
  const totalPositionValue = positions.reduce((s, p) => s + Number(p.position_value), 0);
  const totalRealizedPnl = history.reduce((s, t) => s + Number(t.pnl), 0);
  const wins = history.filter(t => Number(t.pnl) >= 0).length;
  const losses = history.filter(t => Number(t.pnl) < 0).length;
  const winRate = history.length > 0 ? (wins / history.length) * 100 : 0;

  async function handleCloseAll() {
    setClosing(true);
    setConfirmClose(false);
    await closeAllPositions();
    await fetchData();
    setClosing(false);
  }

  async function handleToggleMode() {
    setTogglingMode(true);
    setConfirmLive(false);
    const success = await togglePaperMode(false);
    if (success) await fetchData();
    setTogglingMode(false);
  }

  async function handleKillSwitch() {
    setTogglingKill(true);
    setConfirmKill(false);
    await toggleKillSwitch('trip');
    await fetchData();
    setTogglingKill(false);
  }

  async function handleResetKillSwitch() {
    setTogglingKill(true);
    await toggleKillSwitch('reset');
    await fetchData();
    setTogglingKill(false);
  }

  const isLive = config?.paperMode === false;
  const killActive = config?.killSwitch === true;
  const dailyLossPct = config && config.liveCapital > 0
    ? (config.dailyLossAccumulator / config.liveCapital) * 100
    : 0;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-5 w-5 text-cyan-400" />
        <h2 className="text-base font-semibold text-zinc-200">Trading Desk</h2>
        <span className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${isLive ? 'bg-red-500/15 text-red-400' : 'bg-cyan-500/15 text-cyan-400'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-red-500' : 'bg-cyan-500'} animate-pulse`} />
          {isLive ? 'LIVE MODE' : 'PAPER MODE'}
        </span>
      </div>

      {/* Kill Switch Banner */}
      {killActive && (
        <div className="mb-4 rounded-xl border border-red-500/50 bg-red-500/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-400">KILL SWITCH ACTIVE — ALL TRADING HALTED</p>
              <p className="text-[11px] text-red-400/70">{config?.killSwitchReason ?? 'Manually tripped'}</p>
            </div>
            <button
              onClick={handleResetKillSwitch}
              disabled={togglingKill}
              className="flex items-center gap-1 rounded-lg bg-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${togglingKill ? 'animate-spin' : ''}`} />
              Reset Switch
            </button>
          </div>
        </div>
      )}

      {/* Mode + Kill Switch Controls */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Mode Toggle */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Power className="h-4 w-4 text-zinc-500" />
            <p className="text-[11px] uppercase text-zinc-600">Trading Mode</p>
          </div>
          {isLive ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-red-400">LIVE — Real Orders</span>
              <span className="text-[10px] text-zinc-600">${config?.liveCapital ?? 5} capital</span>
            </div>
          ) : (
            confirmLive ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-red-400">Switch to LIVE with $5?</p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleToggleMode}
                    disabled={togglingMode}
                    className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {togglingMode ? 'Switching...' : 'Go Live ($5)'}
                  </button>
                  <button
                    onClick={() => setConfirmLive(false)}
                    className="rounded-lg bg-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmLive(true)}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
              >
                Switch to Live Trading
              </button>
            )
          )}
        </div>

        {/* Kill Switch */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-zinc-500" />
            <p className="text-[11px] uppercase text-zinc-600">Kill Switch</p>
          </div>
          {killActive ? (
            <span className="text-sm font-bold text-red-400">TRIPPED</span>
          ) : confirmKill ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleKillSwitch}
                disabled={togglingKill}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {togglingKill ? 'Tripping...' : 'Confirm Trip'}
              </button>
              <button
                onClick={() => setConfirmKill(false)}
                className="rounded-lg bg-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmKill(true)}
              className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
            >
              Trip Kill Switch
            </button>
          )}
        </div>

        {/* Daily Loss Tracker */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-zinc-500" />
            <p className="text-[11px] uppercase text-zinc-600">Daily Loss Limit</p>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`font-mono text-lg font-bold tabular-nums ${dailyLossPct >= (config?.maxDailyLossPct ?? 10) * 0.8 ? 'text-red-400' : 'text-zinc-200'}`}>
              {dailyLossPct.toFixed(1)}%
            </span>
            <span className="text-[10px] text-zinc-600">/ {config?.maxDailyLossPct ?? 10}% max</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
            <div
              className={`h-1.5 rounded-full transition-all ${dailyLossPct >= (config?.maxDailyLossPct ?? 10) * 0.8 ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(dailyLossPct / (config?.maxDailyLossPct ?? 10) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Win Rate Gate Display */}
      {config?.strategyWinRates && Object.keys(config.strategyWinRates).length > 0 && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-4 w-4 text-zinc-500" />
            <p className="text-[11px] uppercase text-zinc-600">
              Win Rate Gate — {config.minWinRateThreshold}% minimum to trade
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(config.strategyWinRates).map(([strategy, stats]) => {
              const eligible = stats.totalTrades < 5 || stats.winRate >= config.minWinRateThreshold;
              const style = strategyStyles[strategy] ?? { color: 'text-zinc-400', bg: 'bg-zinc-700/40', label: strategy };
              return (
                <div key={strategy} className={`rounded-lg p-2.5 ${eligible ? 'bg-zinc-950/40' : 'bg-zinc-950/40 opacity-50'}`}>
                  <p className={`text-[10px] font-semibold ${style.color}`}>{style.label}</p>
                  <p className="mt-1 font-mono text-sm font-bold tabular-nums text-zinc-200">
                    {stats.winRate.toFixed(1)}%
                  </p>
                  <p className="text-[9px] text-zinc-600">
                    {stats.totalTrades} trades {eligible ? '' : '— BLOCKED'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-[11px] uppercase text-zinc-600">Open Positions</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-200">{positions.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-[11px] uppercase text-zinc-600">Unrealized P&L</p>
          <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalUnrealizedPnl >= 0 ? '+' : ''}{totalUnrealizedPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-[11px] uppercase text-zinc-600">Realized P&L</p>
          <p className={`mt-1 font-mono text-lg font-bold tabular-nums ${totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRealizedPnl >= 0 ? '+' : ''}{totalRealizedPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-[11px] uppercase text-zinc-600">Win Rate</p>
          <p className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-200">
            {winRate.toFixed(1)}%
            <span className="ml-1 text-[10px] text-zinc-600">({wins}W / {losses}L)</span>
          </p>
        </div>
      </div>

      {/* Open Positions */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">Open Positions</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg bg-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {positions.length > 0 && (
              confirmClose ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCloseAll}
                    disabled={closing}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {closing ? 'Closing...' : 'Confirm Close All'}
                  </button>
                  <button
                    onClick={() => setConfirmClose(false)}
                    className="rounded-lg bg-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClose(true)}
                  className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20"
                >
                  <X className="h-3 w-3" />
                  Close All
                </button>
              )
            )}
          </div>
        </div>

        {positions.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-600">No open positions. Run a strategy scan to open trades.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {positions.map(p => {
              const meta = FACTIONS.find(f => f.id === p.faction_id);
              const style = strategyStyles[p.strategy] ?? { color: 'text-zinc-400', bg: 'bg-zinc-700/40', label: p.strategy };
              const isLong = p.side === 'long';
              const pnlPositive = p.unrealized_pnl >= 0;
              const pnlPct = p.pnl_pct ?? 0;
              const entry = Number(p.entry_price);
              const current = p.current_price ?? entry;
              const stop = Number(p.stop_loss);
              const target = Number(p.take_profit);
              const liveTrade = (p as OpenPosition & { is_live?: boolean }).is_live;

              return (
                <div key={p.id} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    {liveTrade && (
                      <span className="flex items-center gap-0.5 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400">
                        <DollarSign className="h-2.5 w-2.5" />
                        LIVE
                      </span>
                    )}
                    <span className={`flex items-center gap-0.5 rounded px-2 py-0.5 text-[10px] font-semibold ${style.bg} ${style.color}`}>
                      <Brain className="h-2.5 w-2.5" />
                      {style.label}
                    </span>
                    <span className={`flex items-center gap-0.5 text-[10px] font-bold uppercase ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isLong ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {p.side}
                    </span>
                    <span className="font-mono text-xs font-semibold text-zinc-300">{p.symbol}</span>
                    <span className="text-[10px] text-zinc-500">{meta?.name ?? p.faction_id}</span>
                    <span className={`ml-auto font-mono text-xs font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnlPositive ? '+' : ''}{p.unrealized_pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                      <span className="ml-1 text-[10px] text-zinc-600">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-zinc-600">
                    <span>Entry: <span className="font-mono tabular-nums text-zinc-400">${entry.toFixed(4)}</span></span>
                    <span>Current: <span className="font-mono tabular-nums text-zinc-400">${current.toFixed(4)}</span></span>
                    <span className="flex items-center gap-0.5">
                      <Shield className="h-2.5 w-2.5 text-red-400/60" />
                      SL: <span className="font-mono tabular-nums text-red-400/70">${stop.toFixed(4)}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Target className="h-2.5 w-2.5 text-emerald-400/60" />
                      TP: <span className="font-mono tabular-nums text-emerald-400/70">${target.toFixed(4)}</span>
                    </span>
                    <span>Size: <span className="font-mono tabular-nums text-zinc-400">${Number(p.position_value).toFixed(2)}</span></span>
                  </div>

                  <p className="mt-1.5 text-[10px] leading-snug text-zinc-600 line-clamp-1">
                    {p.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trade History */}
      {history.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">Closed Trades</h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {history.map(t => {
              const meta = FACTIONS.find(f => f.id === t.faction_id);
              const style = strategyStyles[t.strategy] ?? { color: 'text-zinc-400', bg: 'bg-zinc-700/40', label: t.strategy };
              const isWin = Number(t.pnl) >= 0;
              const pnl = Number(t.pnl);
              const liveTrade = (t as PaperTrade & { is_live?: boolean }).is_live;

              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/40">
                  {liveTrade && (
                    <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-bold text-red-400">LIVE</span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.color}`}>
                    {style.label}
                  </span>
                  <span className={`font-bold uppercase ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.side}
                  </span>
                  <span className="font-mono text-zinc-300">{t.symbol}</span>
                  <span className="text-[10px] text-zinc-500">{meta?.name ?? t.faction_id}</span>
                  <span className="font-mono tabular-nums text-zinc-600">
                    ${Number(t.entry_price).toFixed(4)} → ${Number(t.exit_price ?? 0).toFixed(4)}
                  </span>
                  <span className={`ml-auto font-mono font-bold tabular-nums ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isWin ? '+' : ''}{pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </span>
                  <span className="font-mono tabular-nums text-zinc-600 text-[10px]">
                    {t.closed_at ? new Date(t.closed_at).toLocaleTimeString() : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
