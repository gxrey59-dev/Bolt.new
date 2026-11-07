import { useCallback, useState } from 'react';
import { BarChart3, DollarSign, TrendingUp, Wallet, Flame } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface ProfitSnapshot {
  day: string;
  trading_pnl: number;
  sweep_revenue: number;
  nft_revenue: number;
  total_revenue: number;
  trade_count: number;
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : 2;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
}

export default function ProfitHistory() {
  const [rows, setRows] = useState<ProfitSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!hasDatabaseAccess) {
      setLoading(false);
      return;
    }
    try {
      const { data, error: dbError } = await supabase
        .from('profit_snapshots')
        .select('day, trading_pnl, sweep_revenue, nft_revenue, total_revenue, trade_count')
        .order('day', { ascending: false })
        .limit(30);
      if (dbError) throw new Error(dbError.message);
      setRows(((data ?? []) as ProfitSnapshot[]).sort((a, b) => (a.day < b.day ? -1 : 1)));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Profit history is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityPolling(fetchData, 60_000, hasDatabaseAccess);

  const total = rows.reduce((s, r) => s + Number(r.total_revenue), 0);
  const trading = rows.reduce((s, r) => s + Number(r.trading_pnl), 0);
  const sweep = rows.reduce((s, r) => s + Number(r.sweep_revenue), 0);
  const nft = rows.reduce((s, r) => s + Number(r.nft_revenue), 0);
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(Number(r.total_revenue))));

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-emerald-400" />
        <h2 className="text-base font-semibold text-zinc-200">Cumulative Profit Ledger</h2>
        <span className="ml-auto text-[10px] text-zinc-600">Last {rows.length} days</span>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-zinc-950/50 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <DollarSign className="h-3 w-3 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Total (30d)</p>
          </div>
          <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">{formatMoney(total)}</p>
        </div>
        <div className="rounded-xl bg-zinc-950/50 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Trading P&L</p>
          </div>
          <p className="font-mono text-lg font-bold tabular-nums text-blue-400">{formatMoney(trading)}</p>
        </div>
        <div className="rounded-xl bg-zinc-950/50 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Wallet className="h-3 w-3 text-cyan-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Sweeps</p>
          </div>
          <p className="font-mono text-lg font-bold tabular-nums text-cyan-400">{formatMoney(sweep)}</p>
        </div>
        <div className="rounded-xl bg-zinc-950/50 p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Flame className="h-3 w-3 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">NFT Mints</p>
          </div>
          <p className="font-mono text-lg font-bold tabular-nums text-amber-400">{formatMoney(nft)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-xs text-zinc-600">Loading history…</div>
      ) : rows.length === 0 ? (
        <p className="flex h-40 items-center justify-center text-xs text-zinc-600">
          No profit recorded yet. Snapshots are captured daily.
        </p>
      ) : (
        <div className="flex h-40 items-end gap-1.5">
          {rows.map(r => {
            const value = Number(r.total_revenue);
            const height = Math.max(2, (Math.abs(value) / maxAbs) * 100);
            const positive = value >= 0;
            return (
              <div key={r.day} className="group relative flex-1">
                <div className="flex h-36 items-end">
                  <div
                    className={`w-full rounded-t transition-all ${positive ? 'bg-emerald-500/70' : 'bg-red-500/70'} group-hover:opacity-100 opacity-80`}
                    style={{ height: `${height}%` }}
                    title={`${r.day}: ${formatMoney(value)}`}
                  />
                </div>
                <p className="mt-1 hidden truncate text-center text-[8px] text-zinc-600 sm:block">
                  {new Date(r.day).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 text-[10px] text-zinc-600">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Profit day</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Loss day</span>
      </div>
    </section>
  );
}
