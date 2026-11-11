import { useCallback, useState } from 'react';
import { Activity, ArrowUpRight, Clock, RefreshCw, ShieldCheck } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { formatRevenue, isVerifiedClose, summarizeRevenue, utcDayStart, type RevenueTrade } from '@/lib/revenueAccounting';

const SPRINT_DATA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-feed/sprint-data`;
interface SprintResponse { trades: RevenueTrade[]; refreshedAt: string; totalCount?: number; truncated?: boolean }

export default function RevenueSprintDashboard() {
  const [data, setData] = useState<SprintResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchTrades = useCallback(async () => {
    try {
      const response = await fetch(SPRINT_DATA_URL, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Trading report returned HTTP ${response.status}.`);
      const next = await response.json() as SprintResponse;
      if (!Array.isArray(next.trades) || !Number.isFinite(Date.parse(next.refreshedAt))) throw new Error('Trading report is incomplete.');
      setData(next); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Trading report is unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useVisibilityPolling(fetchTrades, 30_000);
  const current = !!data && !error;
  const complete = current && data.truncated === false && typeof data.totalCount === 'number' && data.totalCount === data.trades.length;
  const stats = summarizeRevenue(data?.trades ?? [], utcDayStart());
  const verifiedPnl = complete && stats.verified.length ? stats.verifiedPnl : null;
  const items = [
    { label: 'Verified P&L · today', value: formatRevenue(verifiedPnl), note: 'Explicitly reconciled closes only' },
    { label: 'Verified closed trades', value: complete ? String(stats.verified.length) : '—', note: 'Current UTC day' },
    { label: 'Awaiting reconciliation', value: complete ? String(stats.pending.length) : '—', note: 'Excluded from verified P&L' },
    { label: 'Recorded open positions', value: complete ? String(stats.openCount) : '—', note: 'Confirm against exchange holdings' },
  ];
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><Activity className="h-6 w-6 text-amber-400" /><h2 className="text-xl font-bold text-zinc-100">Today's trading report</h2></div><p className="text-sm text-zinc-400">Live trade records for {new Date().toISOString().slice(0, 10)} UTC, plus positions carried forward.</p></div><a href="#execution" className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-zinc-800">Verify exchange holdings<ArrowUpRight className="h-4 w-4" /></a></div>
        <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><Clock className="h-3 w-3" />{data ? `Last successful refresh ${new Date(data.refreshedAt).toLocaleString()}` : 'Waiting for the first successful refresh'}</p>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error} Displayed history is stale; totals are unavailable.</p>}
      {current && !complete && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">History completeness has not been confirmed. The records below are a partial view; daily totals are unavailable.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(item => <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-xs text-zinc-400">{item.label}</p><p className="mt-3 font-mono text-2xl font-bold text-zinc-100">{item.value}</p><p className="mt-2 text-xs text-zinc-500">{item.note}</p></div>)}</div>
      <div className="flex items-start gap-2 rounded-xl border border-zinc-800 p-4 text-xs leading-relaxed text-zinc-400"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" /><p>Verified results require accounting verification on each live closed trade. A closed status alone does not confirm the exchange sold the asset. No daily return is projected from this history.</p></div>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"><h3 className="mb-4 text-sm font-semibold text-zinc-200">Trade records</h3>
        {loading ? <div className="flex justify-center p-8"><RefreshCw className="h-5 w-5 animate-spin text-zinc-500" /></div> : data && data.trades.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="text-zinc-500"><tr><th className="pb-3">Pair</th><th>Strategy group</th><th>Recorded status</th><th>Closed / opened</th><th className="text-right">Verified P&amp;L</th></tr></thead><tbody>{data.trades.map(trade => <tr key={trade.id} className="border-t border-zinc-800 text-zinc-300"><td className="py-3 font-mono font-semibold">{trade.symbol}</td><td className="capitalize">{trade.faction_id}</td><td><span className={trade.status === 'open' ? 'text-cyan-300' : isVerifiedClose(trade) ? 'text-emerald-300' : 'text-amber-300'}>{trade.status === 'open' ? 'Open record' : isVerifiedClose(trade) ? 'Verified close' : 'Unverified close'}</span></td><td>{new Date(trade.closed_at ?? trade.opened_at).toLocaleString()}</td><td className="text-right font-mono">{current && isVerifiedClose(trade) ? formatRevenue(Number(trade.pnl)) : '—'}</td></tr>)}</tbody></table></div> : current ? <p className="py-8 text-center text-sm text-zinc-500">No trades were returned for this window.</p> : <p className="py-8 text-center text-sm text-zinc-500">Trade history is unavailable.</p>}
      </div>
    </section>
  );
}
