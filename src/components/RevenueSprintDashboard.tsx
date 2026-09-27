import { useState, useEffect, useCallback } from 'react';
import {
  Flame, TrendingUp, TrendingDown, Zap, Target, Clock,
  DollarSign, Activity, ArrowUp, ArrowDown, Trophy, Rocket,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Trade {
  id: string;
  faction_id: string;
  symbol: string;
  side: string;
  strategy: string;
  entry_price: number;
  exit_price: number | null;
  pnl: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface SprintStats {
  totalPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
  winRate: number;
  bestTrade: number;
  worstTrade: number;
  lastClose: string | null;
  openCount: number;
}

function timeRemaining(): { hours: number; minutes: number; seconds: number; pct: number } {
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setUTCHours(23, 59, 59, 999);
  const diff = tomorrow.getTime() - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const dayMs = 86400000;
  const pct = ((dayMs - diff) / dayMs) * 100;
  return { hours: h, minutes: m, seconds: s, pct };
}

export default function RevenueSprintDashboard() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(timeRemaining());

  const fetchTrades = useCallback(async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('paper_trades')
      .select('*')
      .or(`opened_at.gte.${today.toISOString()},closed_at.gte.${today.toISOString()}`)
      .order('opened_at', { ascending: false })
      .limit(100);
    setTrades((data ?? []) as Trade[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTrades();
    const tradeId = setInterval(fetchTrades, 3000);
    const clockId = setInterval(() => setCountdown(timeRemaining()), 1000);
    return () => { clearInterval(tradeId); clearInterval(clockId); };
  }, [fetchTrades]);

  const closed = trades.filter(t => t.status === 'closed');
  const open = trades.filter(t => t.status === 'open');

  const stats: SprintStats = {
    totalPnl: closed.reduce((s, t) => s + Number(t.pnl), 0),
    totalTrades: closed.length,
    wins: closed.filter(t => Number(t.pnl) > 0).length,
    losses: closed.filter(t => Number(t.pnl) <= 0).length,
    avgWin: closed.filter(t => Number(t.pnl) > 0).reduce((s, t) => s + Number(t.pnl), 0) / Math.max(closed.filter(t => Number(t.pnl) > 0).length, 1),
    avgLoss: closed.filter(t => Number(t.pnl) < 0).reduce((s, t) => s + Number(t.pnl), 0) / Math.max(closed.filter(t => Number(t.pnl) < 0).length, 1),
    winRate: closed.length > 0 ? (closed.filter(t => Number(t.pnl) > 0).length / closed.length) * 100 : 0,
    bestTrade: closed.length > 0 ? Math.max(...closed.map(t => Number(t.pnl))) : 0,
    worstTrade: closed.length > 0 ? Math.min(...closed.map(t => Number(t.pnl))) : 0,
    lastClose: closed.length > 0 ? closed[0]?.closed_at ?? null : null,
    openCount: open.length,
  };

  // Projected daily revenue at current pace
  const tradesPerHour = stats.totalTrades > 0 && countdown.pct > 0
    ? stats.totalTrades / (countdown.pct / 100 * 24)
    : 0;
  const avgPnlPerTrade = stats.totalTrades > 0 ? stats.totalPnl / stats.totalTrades : 0;
  const projectedDailyPnl = tradesPerHour * avgPnlPerTrade * 24;

  // Per-faction breakdown today
  const factionMap: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of closed) {
    if (!factionMap[t.faction_id]) factionMap[t.faction_id] = { pnl: 0, trades: 0, wins: 0 };
    factionMap[t.faction_id].pnl += Number(t.pnl);
    factionMap[t.faction_id].trades++;
    if (Number(t.pnl) > 0) factionMap[t.faction_id].wins++;
  }
  const factionRanking = Object.entries(factionMap).sort((a, b) => b[1].pnl - a[1].pnl);

  // Per-symbol breakdown
  const symbolMap: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of closed) {
    if (!symbolMap[t.symbol]) symbolMap[t.symbol] = { pnl: 0, trades: 0, wins: 0 };
    symbolMap[t.symbol].pnl += Number(t.pnl);
    symbolMap[t.symbol].trades++;
    if (Number(t.pnl) > 0) symbolMap[t.symbol].wins++;
  }
  const symbolRanking = Object.entries(symbolMap).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 8);

  return (
    <section className="space-y-5">
      {/* Sprint Header — 24h countdown */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="h-6 w-6 text-amber-400" />
              <h2 className="text-xl font-bold text-zinc-100">24-Hour Revenue Sprint</h2>
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 animate-pulse">LIVE</span>
            </div>
            <p className="text-sm text-zinc-400">
              Maximum aggression mode. Tighter stops, bigger positions, faster exits.
              Every dollar tracked in real-time.
            </p>
          </div>

          {/* Countdown clock */}
          <div className="text-right">
            <div className="flex items-center gap-1.5 mb-1 justify-end">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-600">Time Remaining</span>
            </div>
            <div className="flex items-center gap-2 font-mono">
              <div className="rounded-lg bg-zinc-950/80 px-3 py-2 text-center">
                <p className="text-2xl font-bold tabular-nums text-amber-400">{String(countdown.hours).padStart(2, '0')}</p>
                <p className="text-[8px] text-zinc-600">HRS</p>
              </div>
              <span className="text-2xl text-zinc-700">:</span>
              <div className="rounded-lg bg-zinc-950/80 px-3 py-2 text-center">
                <p className="text-2xl font-bold tabular-nums text-amber-400">{String(countdown.minutes).padStart(2, '0')}</p>
                <p className="text-[8px] text-zinc-600">MIN</p>
              </div>
              <span className="text-2xl text-zinc-700">:</span>
              <div className="rounded-lg bg-zinc-950/80 px-3 py-2 text-center">
                <p className="text-2xl font-bold tabular-nums text-amber-400">{String(countdown.seconds).padStart(2, '0')}</p>
                <p className="text-[8px] text-zinc-600">SEC</p>
              </div>
            </div>
            <div className="mt-1.5 h-1 w-40 ml-auto rounded-full bg-zinc-800">
              <div className="h-1 rounded-full bg-gradient-to-r from-amber-500 to-red-500 transition-all" style={{ width: `${countdown.pct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Core P&L Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className={`rounded-xl border p-4 ${stats.totalPnl >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSign className="h-3.5 w-3.5 text-zinc-500" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Today P&L</p>
          </div>
          <p className={`font-mono text-2xl font-bold tabular-nums ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Trades</p>
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums text-zinc-100">{stats.totalTrades}</p>
          <p className="text-[9px] text-zinc-600">{stats.openCount} open now</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Trophy className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Win Rate</p>
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums text-amber-400">{stats.winRate.toFixed(1)}%</p>
          <p className="text-[9px] text-zinc-600">{stats.wins}W / {stats.losses}L</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Avg Win</p>
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums text-emerald-400">+${stats.avgWin.toFixed(4)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowDown className="h-3.5 w-3.5 text-red-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Avg Loss</p>
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums text-red-400">${stats.avgLoss.toFixed(4)}</p>
        </div>
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Rocket className="h-3.5 w-3.5 text-purple-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Proj. 24h</p>
          </div>
          <p className={`font-mono text-2xl font-bold tabular-nums ${projectedDailyPnl >= 0 ? 'text-purple-400' : 'text-red-400'}`}>
            {projectedDailyPnl >= 0 ? '+' : ''}${projectedDailyPnl.toFixed(4)}
          </p>
          <p className="text-[9px] text-zinc-600">{tradesPerHour.toFixed(1)}/hr</p>
        </div>
      </div>

      {/* Two-column: Faction ranking + Symbol ranking */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Faction leaderboard */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-bold text-zinc-100">Faction Leaderboard</h3>
          </div>
          {factionRanking.length === 0 ? (
            <p className="text-center text-xs text-zinc-600 py-6">No closed trades today yet</p>
          ) : (
            <div className="space-y-2">
              {factionRanking.map(([factionId, data], i) => (
                <div key={factionId} className="flex items-center gap-3">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0 ${
                    i === 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>{i + 1}</span>
                  <span className="text-xs font-semibold text-zinc-300 capitalize flex-shrink-0 w-20 truncate">{factionId}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${data.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(Math.abs(data.pnl) / Math.max(...factionRanking.map(([, d]) => Math.abs(d.pnl))) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={`font-mono text-xs font-bold tabular-nums flex-shrink-0 w-20 text-right ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(4)}
                  </span>
                  <span className="text-[9px] text-zinc-600 flex-shrink-0 w-12 text-right">{data.trades} trades</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Symbol performance */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-zinc-100">Top Symbols Today</h3>
          </div>
          {symbolRanking.length === 0 ? (
            <p className="text-center text-xs text-zinc-600 py-6">No closed trades today yet</p>
          ) : (
            <div className="space-y-2">
              {symbolRanking.map(([symbol, data]) => (
                <div key={symbol} className="flex items-center gap-3">
                  <span className="font-mono text-xs font-bold text-zinc-300 flex-shrink-0 w-20">{symbol.replace('USDT', '')}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${data.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(Math.abs(data.pnl) / Math.max(...symbolRanking.map(([, d]) => Math.abs(d.pnl))) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={`font-mono text-xs font-bold tabular-nums flex-shrink-0 w-20 text-right ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(4)}
                  </span>
                  <span className="text-[9px] text-zinc-600 flex-shrink-0 w-16 text-right">
                    {data.wins}/{data.trades} win
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live trade feed */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-zinc-100">Live Trade Feed</h3>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            REAL-TIME
          </span>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Activity className="h-5 w-5 animate-spin text-zinc-700" />
          </div>
        ) : trades.length === 0 ? (
          <p className="text-center text-xs text-zinc-600 py-6">Waiting for first trade...</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {trades.slice(0, 30).map(t => {
              const pnl = Number(t.pnl);
              const isWin = pnl > 0;
              const isOpen = t.status === 'open';
              const time = new Date(t.opened_at).toLocaleTimeString('en-US', { hour12: false });
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${
                    isOpen ? 'bg-zinc-950/60 border border-blue-500/20' : 'bg-zinc-950/40'
                  }`}
                >
                  <span className="font-mono text-[10px] text-zinc-600 flex-shrink-0">{time}</span>
                  <span className={`flex items-center gap-1 font-bold flex-shrink-0 ${isOpen ? 'text-blue-400' : isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isOpen ? 'OPEN' : isWin ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  </span>
                  <span className="font-mono font-bold text-zinc-200 flex-shrink-0 w-16">{t.symbol.replace('USDT', '')}</span>
                  <span className={`text-[10px] font-semibold flex-shrink-0 ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-zinc-600 capitalize flex-shrink-0 hidden sm:block">{t.strategy.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-zinc-600 capitalize flex-shrink-0 hidden md:block">{t.faction_id}</span>
                  <span className="font-mono text-[10px] text-zinc-500 flex-shrink-0">${Number(t.entry_price).toFixed(4)}</span>
                  <span className="ml-auto font-mono font-bold tabular-nums flex-shrink-0">
                    {isOpen ? (
                      <span className="text-blue-400">—</span>
                    ) : (
                      <span className={isWin ? 'text-emerald-400' : 'text-red-400'}>
                        {isWin ? '+' : ''}${pnl.toFixed(4)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Best & Worst trades */}
      {stats.totalTrades > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">Best Trade Today</p>
            </div>
            <p className="font-mono text-xl font-bold tabular-nums text-emerald-400">+${stats.bestTrade.toFixed(4)}</p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-400" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">Worst Trade Today</p>
            </div>
            <p className="font-mono text-xl font-bold tabular-nums text-red-400">${stats.worstTrade.toFixed(4)}</p>
          </div>
        </div>
      )}
    </section>
  );
}
