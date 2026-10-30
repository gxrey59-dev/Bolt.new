import { useCallback, useMemo, useState } from 'react';
import { Activity, BarChart3, Percent, Trophy, Wallet, Clock } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { FACTIONS } from '@/lib/constants';
import {
  PERFORMANCE_WINDOWS,
  buildDailyHarvest,
  buildFactionPerformance,
  parseDbTimestamp,
  type PerformanceWindow,
  type TradeRecord,
} from '@/lib/factionPerformance';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

const HARVEST_DAYS = 14;

const STATUS_STYLES: Record<Faction['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-400',
  cooldown: 'bg-blue-500/15 text-blue-400',
  halted: 'bg-red-500/15 text-red-400',
};

function formatUsd(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : '+'}${abs}`;
}

function pnlClass(value: number): string {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-zinc-400';
}

function timeAgo(stamp: string | null): string {
  const millis = parseDbTimestamp(stamp);
  if (Number.isNaN(millis)) return 'No activity';
  const minutes = Math.max(0, Math.floor((Date.now() - millis) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function FactionPerformanceDashboard({ factions }: Props) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [windowId, setWindowId] = useState<PerformanceWindow>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTrades = useCallback(async () => {
    if (!hasDatabaseAccess) {
      setError('Database access is not configured.');
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase
      .from('paper_trades')
      .select('faction_id, status, pnl, opened_at, closed_at')
      .eq('is_live', true)
      .order('opened_at', { ascending: false })
      .limit(5000);
    if (queryError) {
      setError('Trade history could not be loaded. Retrying shortly.');
      setLoading(false);
      return;
    }
    setTrades((data ?? []) as TradeRecord[]);
    setError('');
    setLoading(false);
  }, []);

  useVisibilityPolling(fetchTrades, 30_000);

  const rows = useMemo(() => {
    const ids = FACTIONS.map(f => f.id);
    return buildFactionPerformance(trades, ids, windowId).sort((a, b) => b.realizedPnl - a.realizedPnl);
  }, [trades, windowId]);

  const harvest = useMemo(() => buildDailyHarvest(trades, HARVEST_DAYS), [trades]);

  const totals = useMemo(() => {
    const closed = rows.reduce((s, r) => s + r.closedTrades, 0);
    const wins = rows.reduce((s, r) => s + r.wins, 0);
    return {
      realized: rows.reduce((s, r) => s + r.realizedPnl, 0),
      harvested: rows.reduce((s, r) => s + r.harvested, 0),
      closed,
      winRate: closed > 0 ? (wins / closed) * 100 : 0,
      open: rows.reduce((s, r) => s + r.openPositions, 0),
      activity: rows.reduce((s, r) => s + r.activity, 0),
    };
  }, [rows]);

  const maxHarvestDay = Math.max(0.01, ...harvest.map(d => Math.abs(d.total)));

  const kpis = [
    { label: 'Realized P&L', value: formatUsd(totals.realized), icon: Wallet, tone: pnlClass(totals.realized) },
    { label: 'Harvested Gains', value: formatUsd(totals.harvested), icon: Trophy, tone: 'text-emerald-400' },
    { label: 'Win Rate', value: `${totals.winRate.toFixed(1)}%`, icon: Percent, tone: 'text-zinc-100' },
    { label: 'Open Positions', value: totals.open.toString(), icon: Activity, tone: 'text-cyan-400' },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-semibold text-zinc-200">Faction Performance</h2>
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1" role="group" aria-label="Time window">
          {PERFORMANCE_WINDOWS.map(w => (
            <button
              key={w.id}
              type="button"
              aria-pressed={windowId === w.id}
              onClick={() => setWindowId(w.id)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                windowId === w.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">Loading trade history...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map(k => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                    <Icon className="h-3.5 w-3.5" />
                    {k.label}
                  </div>
                  <p className={`font-mono text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p>
                  <p className="mt-1 text-[11px] text-zinc-600">
                    {totals.closed} closed trades, {totals.activity} active in window
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">Daily Profit Harvest</h3>
              <span className="text-[11px] text-zinc-500">Last {HARVEST_DAYS} days</span>
            </div>
            <svg viewBox="0 0 640 170" className="h-44 w-full" role="img" aria-label="Daily realized profit and loss">
              <line x1="0" y1="85" x2="640" y2="85" className="stroke-zinc-700" strokeWidth="1" />
              {harvest.map((d, i) => {
                const slot = 640 / harvest.length;
                const barWidth = slot * 0.6;
                const x = i * slot + (slot - barWidth) / 2;
                const height = Math.max(1, (Math.abs(d.total) / maxHarvestDay) * 70);
                const y = d.total >= 0 ? 85 - height : 85;
                const fill = d.total > 0 ? '#10b981' : d.total < 0 ? '#ef4444' : '#52525b';
                return (
                  <g key={d.day}>
                    <title>{`${d.day}: ${formatUsd(d.total)}`}</title>
                    <rect x={x} y={y} width={barWidth} height={height} rx="2" fill={fill} opacity={0.85} />
                    <text x={x + barWidth / 2} y="162" textAnchor="middle" className="fill-zinc-500 text-[9px]">
                      {d.day.slice(5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[960px] text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-zinc-400">
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Faction</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Realized P&L</th>
                  <th className="px-4 py-3 font-semibold">Harvested</th>
                  <th className="px-4 py-3 text-right font-semibold">Leaked</th>
                  <th className="px-4 py-3 text-right font-semibold">Win Rate</th>
                  <th className="px-4 py-3 text-right font-semibold">Profit Factor</th>
                  <th className="px-4 py-3 text-right font-semibold">Avg / Trade</th>
                  <th className="px-4 py-3 text-right font-semibold">Best / Worst</th>
                  <th className="px-4 py-3 text-right font-semibold">Open</th>
                  <th className="px-4 py-3 text-right font-semibold">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meta = FACTIONS.find(fm => fm.id === r.factionId);
                  const faction = factions.find(f => f.id === r.factionId);
                  const share = totals.harvested > 0 ? (r.harvested / totals.harvested) * 100 : 0;
                  return (
                    <tr key={r.factionId} className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5 font-mono text-zinc-600">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-zinc-200">{meta?.name ?? r.factionId}</p>
                        <p className="text-[11px] text-zinc-500">{meta?.member}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${faction ? STATUS_STYLES[faction.status] : 'bg-zinc-800 text-zinc-400'}`}>
                          {faction?.status ?? 'unknown'}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${pnlClass(r.realizedPnl)}`}>
                        {formatUsd(r.realizedPnl)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-16 font-mono tabular-nums text-emerald-400">{formatUsd(r.harvested)}</span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-400">{formatUsd(r.leaked)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-300">
                        {r.closedTrades > 0 ? `${r.winRate.toFixed(1)}%` : '--'}
                        <span className="ml-1 text-[10px] text-zinc-600">({r.wins}W/{r.losses}L)</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-300">
                        {r.profitFactor === null ? '--' : r.profitFactor.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${pnlClass(r.avgPnl)}`}>
                        {r.closedTrades > 0 ? formatUsd(r.avgPnl) : '--'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-400">
                        {r.closedTrades > 0 ? `${formatUsd(r.bestTrade)} / ${formatUsd(r.worstTrade)}` : '--'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-cyan-400">{r.openPositions}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(r.lastActivity)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {trades.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">No live trades have been recorded yet.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
