import { useState, useCallback } from 'react';
import { ArrowUpRight, Crown, RefreshCw, Target, ShieldCheck, CircleAlert } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { loadRevenueTrades } from '@/lib/revenueData';
import { formatRevenue, summarizeRevenue, type RevenueTrade } from '@/lib/revenueAccounting';

interface RevenueStream {
  id: string; name: string; category: string; target_revenue: number;
  status: string; blockers: string; next_milestone: string;
}

export default function RevenueCommandCenter() {
  const [streams, setStreams] = useState<RevenueStream[]>([]);
  const [trades, setTrades] = useState<RevenueTrade[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasDatabaseAccess);
  const [error, setError] = useState('');
  const fetchData = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [plans, records] = await Promise.all([
        supabase.from('revenue_streams').select('id, name, category, target_revenue, status, blockers, next_milestone').order('target_revenue', { ascending: false }),
        loadRevenueTrades(since),
      ]);
      if (plans.error) throw new Error(plans.error.message);
      setStreams(plans.data ?? []);
      setTrades(records);
      setFetchedAt(new Date().toISOString());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Revenue reporting is unavailable.');
    } finally { setLoading(false); }
  }, []);
  useVisibilityPolling(fetchData, 60_000, hasDatabaseAccess);
  const summary = summarizeRevenue(trades, Date.now() - 30 * 86_400_000);
  const available = !!fetchedAt && !error;

  return (
    <section className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-3"><Crown className="h-6 w-6 text-amber-400" /><h2 className="text-xl font-bold text-zinc-100">Revenue Command Center</h2></div>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">Track reconciled trading results, then plan the next revenue milestone. Sales, transfers, and trading returns have separate accounting.</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><p className="mb-2 flex items-center gap-2 text-xs text-zinc-400"><ShieldCheck className="h-4 w-4 text-emerald-400" />Verified trading P&amp;L · 30d</p><p className="font-mono text-2xl font-semibold text-zinc-100">{formatRevenue(available && summary.verified.length ? summary.verifiedPnl : null)}</p><p className="mt-1 text-xs text-zinc-500">{available ? `${summary.verified.length} verified closed trades` : 'Awaiting verified history'}</p></div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><p className="mb-2 flex items-center gap-2 text-xs text-zinc-400"><CircleAlert className="h-4 w-4 text-amber-400" />Awaiting reconciliation</p><p className="font-mono text-2xl font-semibold text-amber-300">{available ? summary.pending.length : '—'}</p><p className="mt-1 text-xs text-zinc-500">Excluded from verified returns</p></div>
            <a href="#execution" className="flex flex-col justify-between rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 transition-colors hover:bg-cyan-500/10"><span className="flex items-center justify-between text-sm font-semibold text-cyan-300">Review exchange execution<ArrowUpRight className="h-4 w-4" /></span><span className="mt-3 text-xs leading-relaxed text-zinc-400">Check holdings, fills, and any unmatched trade records.</span></a>
          </div>
          <p className="mt-4 text-xs text-zinc-500">{fetchedAt ? `Database checked ${new Date(fetchedAt).toLocaleString()} · rolling 30-day window` : 'Source: live trade ledger with explicit accounting verification'}</p>
        </div>
      </div>
      {!hasDatabaseAccess && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">Connect the app to its database to load revenue records.</p>}
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error} Revenue totals are unavailable until the next successful refresh.</p>}
      <div className="flex items-center gap-2"><Target className="h-4 w-4 text-amber-400" /><h3 className="font-semibold text-zinc-200">Revenue plans</h3><span className="ml-auto text-xs text-zinc-500">Targets require validation</span></div>
      <p className="text-xs leading-relaxed text-zinc-500">Saved targets and milestones are planning inputs. They do not establish current revenue, growth, or a completion date.</p>
      {loading ? <div className="flex justify-center p-12"><RefreshCw className="h-5 w-5 animate-spin text-zinc-500" /></div> : !error && hasDatabaseAccess && streams.length === 0 ? <p className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-500">No revenue plans have been recorded.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">{streams.map(stream => (
          <article key={stream.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <p className="text-[10px] uppercase tracking-widest text-amber-400">{stream.category} · planning</p>
            <h4 className="mt-2 text-base font-semibold text-zinc-100">{stream.name}</h4>
            <div className="my-4 flex items-baseline justify-between gap-4"><span className="text-xs text-zinc-500">Saved monthly target</span><span className="font-mono text-lg text-zinc-200">{formatRevenue(Number(stream.target_revenue))}</span></div>
            <div className="space-y-3 border-t border-zinc-800 pt-4 text-xs leading-relaxed"><div><p className="font-semibold text-zinc-300">Next milestone</p><p className="mt-1 text-zinc-400">{stream.next_milestone || 'Define a measurable next milestone.'}</p></div><div><p className="font-semibold text-zinc-300">Dependencies</p><p className="mt-1 text-zinc-500">{stream.blockers || 'Review launch requirements before activation.'}</p></div></div>
          </article>
        ))}</div>
      )}
    </section>
  );
}
