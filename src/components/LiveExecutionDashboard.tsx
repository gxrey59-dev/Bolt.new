import { useCallback, useState } from 'react';
import { Activity, Download, RefreshCw, Wallet } from 'lucide-react';
import ExecutionOrdersTable from '@/components/ExecutionOrdersTable';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { buildExecutionOrders, type ExecutionOrder } from '@/lib/executionOrders';
import { buildExecutionCsv, downloadCsv } from '@/lib/executionCsv';
import type { SymbolHistory } from '@/lib/tradePnl';

interface Balance { asset: string; free: number; locked: number }
interface AccountResponse { ok: true; balances: Balance[]; fetchedAt: string }
interface OrdersResponse { ok: true; symbols: SymbolHistory[]; fetchedAt: string }
interface TradeEventRow { message: string }

const TRADE_EVENT_PATTERN = /^LIVE: (\S+) (?:opened|closed) (?:LONG|SHORT) on \S+ .*\[Order: (\d+)\]/;

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMoney(value: number, digits = 2) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Exchange connection returned HTTP ${res.status}.`);
  return data as T;
}

async function fetchFactionByOrderId(): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('message')
    .in('event_type', ['live_trade_open', 'live_trade_close'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const map = new Map<number, string>();
  for (const row of (data ?? []) as TradeEventRow[]) {
    const match = TRADE_EVENT_PATTERN.exec(row.message);
    if (match && !map.has(Number(match[2]))) map.set(Number(match[2]), capitalize(match[1]));
  }
  return map;
}

export default function LiveExecutionDashboard() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [orders, setOrders] = useState<ExecutionOrder[]>([]);
  const [histories, setHistories] = useState<SymbolHistory[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [account, history, factionByOrderId] = await Promise.all([
        operatorFetch('binance-account/account').then(readJson<AccountResponse>),
        operatorFetch('binance-account/orders').then(readJson<OrdersResponse>),
        fetchFactionByOrderId(),
      ]);
      setBalances(account.balances);
      setHistories(history.symbols);
      setOrders(buildExecutionOrders(history.symbols, factionByOrderId));
      setFetchedAt(history.fetchedAt);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Exchange data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityPolling(refresh, 15_000, hasDatabaseAccess);

  const usdt = balances.find(b => b.asset === 'USDT');
  const filledCount = orders.filter(o => o.status === 'FILLED').length;
  const openCount = orders.filter(o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED').length;
  const realizedTotal = orders.reduce((sum, o) => sum + (o.pnl?.realizedPnl ?? 0), 0);
  const realizedTone = realizedTotal > 0 ? 'text-emerald-400' : realizedTotal < 0 ? 'text-red-400' : 'text-zinc-100';

  function exportCsv() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csv = buildExecutionCsv(balances, orders, histories, new Date().toISOString());
    downloadCsv(`live-execution-${stamp}.csv`, csv);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Activity className="h-5 w-5 text-emerald-400" />
        <h2 className="text-base font-semibold text-zinc-200">Live Execution</h2>
        <span className="flex items-center gap-2 text-[11px] text-zinc-500">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {fetchedAt ? `Updated ${formatTime(new Date(fetchedAt).getTime())}` : 'Connecting to exchange'}
        </span>
        <button
          onClick={exportCsv}
          disabled={loading || orders.length === 0}
          className="ml-auto flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
            <Wallet className="h-4 w-4 text-amber-400" /> Free USDT
          </div>
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">
            {usdt ? `$${formatMoney(usdt.free)}` : loading ? '...' : '$0.00'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 text-xs font-medium text-zinc-500">Realized P&amp;L</div>
          <p className={`text-2xl font-semibold tabular-nums ${realizedTone}`}>
            {realizedTotal > 0 ? '+' : realizedTotal < 0 ? '-' : ''}${formatMoney(Math.abs(realizedTotal))}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 text-xs font-medium text-zinc-500">Filled orders</div>
          <p className="text-2xl font-semibold tabular-nums text-emerald-400">{filledCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 text-xs font-medium text-zinc-500">Open orders</div>
          <p className="text-2xl font-semibold tabular-nums text-sky-400">{openCount}</p>
        </div>
      </div>

      <ExecutionOrdersTable orders={orders} loading={loading} />
    </section>
  );
}
