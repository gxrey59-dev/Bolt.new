import { useMemo } from 'react';
import { Table, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { FACTIONS } from '@/lib/constants';
import { buildFactionPerformance } from '@/lib/factionPerformance';
import { useLiveTrades } from '@/lib/useLiveTrades';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

function formatUsd(value: number, forceSign = true) {
  const sign = value < 0 ? '-' : forceSign && value > 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const tone = (value: number) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-zinc-400');

export default function TableView({ factions }: Props) {
  const { trades, error } = useLiveTrades();

  const rows = useMemo(() => {
    const ids = factions.map(f => f.id);
    const day = new Map(buildFactionPerformance(trades ?? [], ids, '24h').map(p => [p.factionId, p]));
    const all = new Map(buildFactionPerformance(trades ?? [], ids, 'all').map(p => [p.factionId, p]));
    return factions
      .map(f => ({ faction: f, meta: FACTIONS.find(fm => fm.id === f.id), day: day.get(f.id)!, all: all.get(f.id)! }))
      .sort((a, b) => b.all.realizedPnl - a.all.realizedPnl);
  }, [trades, factions]);

  const dayProfit = rows.reduce((s, r) => s + r.day.harvested, 0);
  const dayLoss = rows.reduce((s, r) => s + r.day.leaked, 0);
  const dayTrades = rows.reduce((s, r) => s + r.day.closedTrades, 0);
  const loading = trades === null;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Table className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">Faction Performance</h2>
        <span className="ml-auto text-[11px] text-zinc-500">Closed live Binance trades</span>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <TrendingUp className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">{loading ? '...' : formatUsd(dayProfit)}</p>
          <p className="text-[10px] uppercase text-zinc-500">Profit (24h)</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <TrendingDown className="mx-auto mb-1 h-4 w-4 text-red-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-red-400">{loading ? '...' : formatUsd(dayLoss)}</p>
          <p className="text-[10px] uppercase text-zinc-500">Loss (24h)</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <DollarSign className="mx-auto mb-1 h-4 w-4 text-amber-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-zinc-200">{loading ? '...' : dayTrades.toLocaleString()}</p>
          <p className="text-[10px] uppercase text-zinc-500">Closed Trades (24h)</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">#</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">Faction</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">Member</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Net 24h</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Profit All-Time</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Loss All-Time</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Net All-Time</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Win Rate</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Trades</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Open</th>
              <th className="px-4 py-3 text-center font-semibold text-zinc-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ faction: f, meta, day, all }, i) => (
              <tr key={f.id} className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30">
                <td className="px-4 py-2.5 font-mono text-zinc-600">{i + 1}</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-200">{meta?.name ?? f.name}</td>
                <td className="px-4 py-2.5 text-zinc-500">{f.member_name}</td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${tone(day.realizedPnl)}`}>{formatUsd(day.realizedPnl)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-400">{formatUsd(all.harvested)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-400">{formatUsd(all.leaked)}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${tone(all.realizedPnl)}`}>{formatUsd(all.realizedPnl)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-300">
                  {all.closedTrades > 0 ? `${all.winRate.toFixed(1)}%` : '\u2014'}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-400">{all.closedTrades}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-400">{all.openPositions}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    f.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : f.status === 'paused'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-red-500/15 text-red-400'
                  }`}>
                    {f.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
