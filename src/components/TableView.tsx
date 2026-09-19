import { Table, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { FACTIONS } from '@/lib/constants';
import type { Faction } from '@/lib/types';

interface Props {
  factions: Faction[];
}

export default function TableView({ factions }: Props) {
  const sorted = [...factions].sort((a, b) => (b.profit_total + b.profit_today) - (a.profit_total + a.profit_today));
  const totalProfit = factions.reduce((s, f) => s + f.profit_today, 0);
  const totalLoss = factions.reduce((s, f) => s + f.loss_today, 0);
  const totalTrades = factions.reduce((s, f) => s + f.trades_today, 0);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Table className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">Faction Performance</h2>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <TrendingUp className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">
            +${totalProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] uppercase text-zinc-600">Total Profit Today</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <TrendingDown className="mx-auto mb-1 h-4 w-4 text-red-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-red-400">
            -${totalLoss.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] uppercase text-zinc-600">Total Loss Today</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <DollarSign className="mx-auto mb-1 h-4 w-4 text-amber-400" />
          <p className="font-mono text-lg font-bold tabular-nums text-zinc-200">
            {totalTrades.toLocaleString()}
          </p>
          <p className="text-[10px] uppercase text-zinc-600">Total Trades</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">#</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">Faction</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-400">Member</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Profit Today</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Loss Today</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Net P&L</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Total Profit</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Win Rate</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-400">Trades</th>
              <th className="px-4 py-3 text-center font-semibold text-zinc-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f, i) => {
              const meta = FACTIONS.find(fm => fm.id === f.id);
              const net = f.profit_today - f.loss_today;
              return (
                <tr key={f.id} className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30">
                  <td className="px-4 py-2.5 font-mono text-zinc-600">{i + 1}</td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-200">{meta?.name ?? f.name}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{f.member_name}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-400">
                    +${f.profit_today.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-red-400">
                    -${f.loss_today.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {net >= 0 ? '+' : ''}${net.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-400">
                    ${f.profit_total.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-300">{f.win_rate.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-400">{f.trades_today}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
