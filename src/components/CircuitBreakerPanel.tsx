import { ShieldAlert } from 'lucide-react';
import { FACTIONS, FACTION_LOSS_THRESHOLD, GLOBAL_LOSS_THRESHOLD } from '@/lib/constants';
import type { CircuitBreaker, Faction } from '@/lib/types';

interface Props {
  breakers: CircuitBreaker[];
  factions: Faction[];
}

export default function CircuitBreakerPanel({ breakers, factions }: Props) {
  const activeBreakers = breakers.filter(b => !b.resolved).slice(0, 10);
  const pausedFactions = factions.filter(f => f.status === 'paused' || f.status === 'halted');

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-red-400" />
        <h2 className="text-base font-semibold text-zinc-200">Circuit Breakers</h2>
        <span className="text-xs text-zinc-500">Protect Ya Neck</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 grid grid-cols-2 gap-4 text-center">
          <div className="rounded-lg bg-zinc-950/60 p-3">
            <p className="text-[10px] uppercase text-zinc-600">Faction Threshold</p>
            <p className="font-mono text-lg font-bold tabular-nums text-amber-400">{(FACTION_LOSS_THRESHOLD * 100).toFixed(0)}%</p>
            <p className="text-[10px] text-zinc-600">hourly loss limit</p>
          </div>
          <div className="rounded-lg bg-zinc-950/60 p-3">
            <p className="text-[10px] uppercase text-zinc-600">Global Threshold</p>
            <p className="font-mono text-lg font-bold tabular-nums text-red-400">{(GLOBAL_LOSS_THRESHOLD * 100).toFixed(0)}%</p>
            <p className="text-[10px] text-zinc-600">daily halt trigger</p>
          </div>
        </div>

        {pausedFactions.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[10px] uppercase text-zinc-600">Affected Factions</p>
            <div className="space-y-1">
              {pausedFactions.map(f => {
                const meta = FACTIONS.find(fm => fm.id === f.id);
                return (
                  <div key={f.id} className="flex items-center justify-between rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-xs">
                    <span className="text-zinc-300">{meta?.name ?? f.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      f.status === 'halted' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                    }`}>
                      {f.status}
                    </span>
                    {f.paused_until && (
                      <span className="font-mono tabular-nums text-zinc-600">
                        until {new Date(f.paused_until).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeBreakers.length > 0 ? (
          <div className="space-y-1">
            <p className="mb-1 text-[10px] uppercase text-zinc-600">Active Violations</p>
            {activeBreakers.map(b => {
              const meta = b.faction_id ? FACTIONS.find(f => f.id === b.faction_id) : null;
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/40">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    b.scope === 'global' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    {b.scope}
                  </span>
                  <span className="text-zinc-400">{meta?.name ?? b.faction_id ?? 'All Factions'}</span>
                  <span className="ml-auto font-mono tabular-nums text-zinc-500">{b.loss_percent.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-xs text-emerald-400/60 py-2">All clear — no active violations</p>
        )}
      </div>
    </section>
  );
}
