import { TrendingUp, TrendingDown, Pause, AlertOctagon, Timer } from 'lucide-react';
import { FACTIONS } from '@/lib/constants';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

const colorMap: Record<string, { border: string; bg: string; text: string }> = {
  amber:  { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  blue:   { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  slate:  { border: 'border-slate-400/30', bg: 'bg-slate-400/10', text: 'text-slate-300' },
  red:    { border: 'border-red-500/30', bg: 'bg-red-500/10', text: 'text-red-400' },
  pink:   { border: 'border-pink-500/30', bg: 'bg-pink-500/10', text: 'text-pink-400' },
  green:  { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  purple: { border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-400' },
  cyan:   { border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  lime:   { border: 'border-lime-500/30', bg: 'bg-lime-500/10', text: 'text-lime-400' },
};

export default function FactionGrid({ factions }: Props) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-lg">W</span>
        <h2 className="text-base font-semibold text-zinc-200">Faction Grid</h2>
        <span className="ml-auto text-xs text-zinc-500">{factions.length} factions</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {factions.map(f => {
          const meta = FACTIONS.find(fm => fm.id === f.id);
          const c = colorMap[meta?.color ?? 'amber'];
          const netPnl = f.profit_today - f.loss_today;

          return (
            <div
              key={f.id}
              className={`group rounded-xl border ${c.border} bg-zinc-900/60 p-4 transition-all hover:bg-zinc-900/80`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className={`text-sm font-bold ${c.text}`}>{meta?.name ?? f.name}</h3>
                  <p className="text-[11px] text-zinc-500">{f.member_name}</p>
                </div>
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    f.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : f.status === 'paused'
                        ? 'bg-amber-500/15 text-amber-400'
                        : f.status === 'cooldown'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {f.status === 'paused' && <Pause className="h-2.5 w-2.5" />}
                  {f.status === 'halted' && <AlertOctagon className="h-2.5 w-2.5" />}
                  {f.status === 'cooldown' && <Timer className="h-2.5 w-2.5" />}
                  {f.status}
                </span>
              </div>

              <p className="mb-3 text-[11px] leading-relaxed text-zinc-500 line-clamp-2">
                {meta?.persona ?? f.persona}
              </p>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-950/60 p-2.5">
                <div>
                  <p className="text-[10px] uppercase text-zinc-600">Net P&L</p>
                  <p className={`font-mono text-sm font-semibold tabular-nums ${netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {netPnl >= 0 ? '+' : ''}{netPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-zinc-600">Win Rate</p>
                  <p className="font-mono text-sm tabular-nums text-zinc-300">{f.win_rate.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-zinc-600">Positions</p>
                  <p className="font-mono text-sm tabular-nums text-zinc-300">
                    {f.open_positions ?? 0}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                  ${f.profit_today.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <div className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-red-500" />
                  ${f.loss_today.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <span className="font-mono tabular-nums text-cyan-400">
                  ${Number(f.paper_balance ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
