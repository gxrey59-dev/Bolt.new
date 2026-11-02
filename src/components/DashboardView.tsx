import { useMemo } from 'react';
import { Trophy, PieChart } from 'lucide-react';
import { useLiveTrades } from '@/lib/useLiveTrades';
import { FACTIONS } from '@/lib/constants';
import { buildFactionPerformance } from '@/lib/factionPerformance';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

const CHART_COLORS = [
  '#f59e0b', '#3b82f6', '#94a3b8', '#ef4444', '#ec4899',
  '#10b981', '#a855f7', '#06b6d4', '#84cc16',
];

function formatUsd(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polarToXY(cx, cy, r, start);
  const e = polarToXY(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export default function DashboardView({ factions }: Props) {
  const { trades, error } = useLiveTrades();

  const chartData = useMemo(() => {
    const perf = new Map(
      buildFactionPerformance(trades ?? [], factions.map(f => f.id), 'all').map(p => [p.factionId, p]),
    );
    return factions
      .map(f => ({
        faction: f,
        meta: FACTIONS.find(fm => fm.id === f.id),
        profit: perf.get(f.id)?.realizedPnl ?? 0,
        closedTrades: perf.get(f.id)?.closedTrades ?? 0,
      }))
      .sort((a, b) => b.profit - a.profit)
      .map((d, i) => ({ ...d, color: CHART_COLORS[i % CHART_COLORS.length] }));
  }, [trades, factions]);

  const totalPnl = chartData.reduce((s, d) => s + d.profit, 0);
  const positiveTotal = chartData.reduce((s, d) => s + Math.max(0, d.profit), 0);
  const leader = chartData[0]?.profit > 0 ? chartData[0] : null;

  let cumAngle = 0;
  const arcs = positiveTotal > 0
    ? chartData.filter(d => d.profit > 0).map(d => {
        const start = cumAngle;
        cumAngle += (d.profit / positiveTotal) * 360;
        return { ...d, startAngle: start, endAngle: cumAngle };
      })
    : [];

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <PieChart className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">Real Trading Results</h2>
        <span className="ml-auto text-[11px] text-zinc-500">Closed live Binance trades</span>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <svg viewBox="0 0 200 200" className="h-56 w-56" aria-label="Profit share by faction">
            {arcs.length === 0 && <circle cx="100" cy="100" r="90" fill="#27272a" />}
            {arcs.length === 1 && <circle cx="100" cy="100" r="90" fill={arcs[0].color} opacity={0.85} />}
            {arcs.length > 1 && arcs.map(a => (
              <path
                key={a.faction.id}
                d={arcPath(100, 100, 90, a.startAngle, a.endAngle - 0.5)}
                fill={a.color}
                opacity={0.85}
                className="transition-opacity hover:opacity-100"
              />
            ))}
            <circle cx="100" cy="100" r="45" fill="#09090b" />
            <text x="100" y="96" textAnchor="middle" className="fill-zinc-400 text-[8px]">
              NET P&amp;L
            </text>
            <text
              x="100"
              y="110"
              textAnchor="middle"
              className={`text-[11px] font-semibold ${totalPnl < 0 ? 'fill-red-400' : 'fill-zinc-100'}`}
            >
              {trades === null ? '...' : formatUsd(totalPnl)}
            </text>
          </svg>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-bold text-amber-400">Carrying the Team</h3>
            </div>
            {leader ? (
              <>
                <p className="text-lg font-bold text-zinc-100">{leader.meta?.name ?? leader.faction.name}</p>
                <p className="text-xs text-zinc-500">{leader.faction.member_name}</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-400">{formatUsd(leader.profit)}</p>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                {trades === null ? 'Loading live results...' : 'No faction has a profitable closed live trade yet.'}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            {chartData.map(d => (
              <div key={d.faction.id} className="flex items-center gap-3 text-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="w-28 truncate text-zinc-400">{d.meta?.name ?? d.faction.name}</span>
                <span className="text-[10px] text-zinc-600">{d.closedTrades} trades</span>
                <span className={`ml-auto font-mono tabular-nums ${d.profit < 0 ? 'text-red-400' : 'text-zinc-300'}`}>
                  {formatUsd(d.profit)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
