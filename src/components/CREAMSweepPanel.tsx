import { Banknote } from 'lucide-react';
import type { Sweep } from '@/lib/types';

interface Props {
  sweeps: Sweep[];
}

export default function CREAMSweepPanel({ sweeps }: Props) {
  const totalSwept = sweeps.reduce((s, sw) => s + sw.amount_swept, 0);
  const latestBalance = sweeps[0]?.master_wallet_balance ?? 0;
  const recent = sweeps.slice(0, 8);
  const hasRealData = sweeps.length > 0;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Banknote className="h-5 w-5 text-amber-400" />
        <h2 className="text-base font-semibold text-zinc-200">C.R.E.A.M. Sweep</h2>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        {!hasRealData ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-zinc-400">No sweeps have happened yet</p>
            <p className="mt-1 max-w-sm mx-auto text-xs leading-relaxed text-zinc-600">
              This panel only records real transfers that landed in your wallet. Every number here is verifiable on-chain — no simulated totals.
            </p>
          </div>
        ) : (
          <>
        <div className="mb-4 grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-[10px] uppercase text-zinc-600">Total Swept</p>
            <p className="font-mono text-lg font-bold tabular-nums text-amber-400">
              ${totalSwept.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-zinc-600">Vault Balance</p>
            <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">
              ${latestBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase text-zinc-600 mb-1">Recent Sweeps</p>
            {recent.map(sw => (
              <div key={sw.id} className="flex items-center justify-between rounded-lg px-2 py-1 text-xs hover:bg-zinc-800/40">
                <span className="text-amber-400 font-mono tabular-nums">
                  +${sw.amount_swept.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
                <span className="text-zinc-500">{sw.bots_swept} bots</span>
                <span className="font-mono tabular-nums text-zinc-600">
                  {new Date(sw.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </section>
  );
}
