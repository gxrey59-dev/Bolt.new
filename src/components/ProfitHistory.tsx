import { useCallback, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { formatRevenue, numericAmount } from '@/lib/revenueAccounting';

interface ProfitSnapshot { day: string; trading_pnl: number; sweep_revenue: number; nft_revenue: number; trade_count: number }
export default function ProfitHistory() {
  const [rows, setRows] = useState<ProfitSnapshot[]>([]);
  const [loading, setLoading] = useState(hasDatabaseAccess);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const fetchData = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      const { data, error: dbError } = await supabase.from('profit_snapshots')
        .select('day, trading_pnl, sweep_revenue, nft_revenue, trade_count').gte('day', since)
        .order('day', { ascending: true }).limit(31);
      if (dbError) throw new Error(dbError.message);
      const snapshots = (data ?? []) as ProfitSnapshot[];
      if (snapshots.some(row => [row.trading_pnl, row.sweep_revenue, row.nft_revenue].some(value => numericAmount(value) === null))) throw new Error('Snapshot amounts are incomplete.');
      setRows(snapshots); setFetchedAt(new Date().toISOString()); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Historical snapshots are unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useVisibilityPolling(fetchData, 60_000, hasDatabaseAccess);
  const available = !!fetchedAt && !error && rows.length > 0;
  const sum = (key: 'trading_pnl' | 'sweep_revenue' | 'nft_revenue') => available ? rows.reduce((total, row) => total + Number(row[key]), 0) : null;
  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex flex-wrap items-center gap-2"><BarChart3 className="h-5 w-5 text-cyan-400" /><h2 className="text-base font-semibold text-zinc-200">Historical book snapshots</h2><span className="ml-auto text-xs text-zinc-500">Last 30 UTC days</span></div>
      <p className="text-xs leading-relaxed text-zinc-400">These stored estimates have no reconciliation flag. Transfers are shown separately and are not added to revenue. NFT amounts are book sales, not confirmation of on-chain minting or net settlement.</p>
      {!hasDatabaseAccess && <p role="status" className="text-sm text-amber-300">Connect the database to view historical snapshots.</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error} Totals are unavailable.</p>}
      <div className="grid gap-3 sm:grid-cols-3">{[
        ['Trading book P&L', sum('trading_pnl')], ['NFT book sales', sum('nft_revenue')], ['Transfers · excluded from revenue', sum('sweep_revenue')],
      ].map(([label, amount]) => <div key={String(label)} className="rounded-xl bg-zinc-950/60 p-4"><p className="text-xs text-zinc-400">{label}</p><p className="mt-2 font-mono text-xl font-semibold text-zinc-200">{formatRevenue(amount as number | null)}</p></div>)}</div>
      {loading ? <p className="py-8 text-center text-sm text-zinc-500">Loading snapshots…</p> : available ? <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead className="text-zinc-500"><tr><th className="py-3">UTC day</th><th className="text-right">Trading estimate</th><th className="text-right">NFT book sales</th><th className="text-right">Transfers</th></tr></thead><tbody>{rows.map(row => <tr key={row.day} className="border-t border-zinc-800 text-zinc-300"><td className="py-3">{row.day}</td><td className="text-right font-mono">{formatRevenue(Number(row.trading_pnl))}</td><td className="text-right font-mono">{formatRevenue(Number(row.nft_revenue))}</td><td className="text-right font-mono">{formatRevenue(Number(row.sweep_revenue))}</td></tr>)}</tbody></table></div> : !error && hasDatabaseAccess ? <p className="py-8 text-center text-sm text-zinc-500">No snapshots in this reporting window.</p> : null}
      {fetchedAt && <p className="text-xs text-zinc-500">Checked {new Date(fetchedAt).toLocaleString()} · {rows.length} recorded days; missing days are not assumed to be zero.</p>}
    </section>
  );
}
