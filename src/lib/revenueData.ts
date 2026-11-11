import { supabase } from './supabase';
import type { RevenueTrade } from './revenueAccounting';

/** Paginate explicitly: Supabase's row cap must not silently truncate a P&L total. */
export async function loadRevenueTrades(since?: string): Promise<RevenueTrade[]> {
  const result: RevenueTrade[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page++) {
    let query = supabase.from('paper_trades')
      .select('id, faction_id, symbol, pnl, status, is_live, accounting_verified, opened_at, closed_at', { count: 'exact' })
      .eq('is_live', true)
      .order('opened_at', { ascending: false })
      .order('id', { ascending: false });
    if (since) query = query.or(`closed_at.gte.${since},status.eq.open`);
    const { data, error, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    if (count === null || !data) throw new Error('Trade history completeness could not be verified.');
    result.push(...data as RevenueTrade[]);
    if (result.length >= count) return result;
    if (data.length < pageSize) throw new Error('Trade history is incomplete. Totals are unavailable.');
  }
  throw new Error('Trade history exceeds the reporting limit. Narrow the reporting period.');
}
