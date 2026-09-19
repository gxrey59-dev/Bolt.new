import { Trophy, PieChart } from 'lucide-react';
import { FACTIONS } from '@/lib/constants';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

const CHART_COLORS = [
  '#f59e0b', '#3b82f6', '#94a3b8', '#ef4444', '#ec4899',
  '#10b981', '#a855f7', '#06b6d4', '#84cc16',
];

export default function DashboardView({ factions }: Props) {
  const totalProfit = factions.reduce((s, f) => s + f.profit_total + f.profit_today, 0);
  const sorted = [...factions].sort((a, b) => (b.profit_total + b.profit_today) - (a.profit_total + a.profit_today));
  const leader = sorted[0];
  const leaderMeta = FACTIONS.find(f => f.id === leader?.id);

  const chartData = sorted.map((f, i) => ({
    faction: f,
    meta: FACTIONS.find(fm => fm.id === f.id),
    profit: f.profit_total + f.profit_today,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  let cumAngle = 0;
  const arcs = chartData.map(d => {
    const pct = totalProfit > 0 ? d.profit / totalProfit : 1 / chartData.length;
    const angle = Math.max(pct, 0.01) * 360;
    const start = cumAngle;
    cumAngle += angle;
    return { ...d, startAngle: start, endAngle: cumAngle };
  });

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

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <PieChart className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">Profit Distribution</h2>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <svg viewBox="0 0 200 200" className="h-56 w-56">
            {arcs.map((a, i) => (
              <path
                key={i}
                d={arcPath(100, 100, 90, a.startAngle, a.endAngle - 0.5)}
                fill={a.color}
                opacity={0.85}
                className="transition-opacity hover:opacity-100"
              />
            ))}
            <circle cx="100" cy="100" r="45" fill="#09090b" />
            <text x="100" y="96" textAnchor="middle" className="fill-zinc-400 text-[8px]">
              TOTAL
            </text>
            <text x="100" y="110" textAnchor="middle" className="fill-zinc-100 text-[11px] font-semibold">
              ${totalProfit >= 1000 ? `${(totalProfit / 1000).toFixed(0)}K` : totalProfit.toFixed(0)}
            </text>
          </svg>
        </div>

        <div className="space-y-4">
          {leader && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
              <div className="mb-2 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-400" />
                <h3 className="text-sm font-bold text-amber-400">Carrying the Team</h3>
              </div>
              <p className="text-lg font-bold text-zinc-100">{leaderMeta?.name ?? leader.name}</p>
              <p className="text-xs text-zinc-500">{leader.member_name}</p>
              <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-400">
                +${(leader.profit_total + leader.profit_today).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            {chartData.map(d => (
              <div key={d.faction.id} className="flex items-center gap-3 text-xs">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                <span className="w-28 truncate text-zinc-400">{d.meta?.name ?? d.faction.name}</span>
                <span className="ml-auto font-mono tabular-nums text-zinc-300">
                  ${d.profit.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
