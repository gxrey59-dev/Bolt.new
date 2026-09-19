import { Crown, Activity, Wallet } from 'lucide-react';
import type { Faction, Sweep } from '@/lib/types';
import { TOTAL_BOTS } from '@/lib/constants';

interface Props {
  factions: Faction[];
  sweeps: Sweep[];
}

export default function Header({ factions, sweeps }: Props) {
  const activeBots = factions.reduce((s, f) => s + (f.status === 'active' ? f.bot_count : 0), 0);
  const latestSweep = sweeps[0];
  const totalPaperBalance = factions.reduce((s, f) => s + Number(f.paper_balance ?? 0), 0);
  const totalOpenPositions = factions.reduce((s, f) => s + Number(f.open_positions ?? 0), 0);
  const vaultBalance = totalPaperBalance > 0 ? totalPaperBalance : (latestSweep?.master_wallet_balance ?? 0);
  const allActive = factions.length > 0 && factions.every(f => f.status === 'active');
  const anyHalted = factions.some(f => f.status === 'halted');

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">
              Wu-Tang Financial Weapon
            </h1>
            <p className="text-xs text-zinc-500">Command Center</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
            <Wallet className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold tabular-nums text-amber-400">
              ${vaultBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] font-semibold uppercase text-cyan-400/70">Paper</span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
            <span className="font-mono text-sm tabular-nums text-zinc-300">
              {totalOpenPositions} open
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span className="font-mono text-sm tabular-nums text-zinc-300">
              {activeBots.toLocaleString()} / {TOTAL_BOTS.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                anyHalted
                  ? 'bg-red-500 animate-pulse'
                  : allActive
                    ? 'bg-emerald-500 animate-pulse-glow'
                    : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span className="text-xs font-medium text-zinc-400">
              {anyHalted ? 'HALTED' : allActive ? 'ALL SYSTEMS GO' : 'PARTIAL'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
