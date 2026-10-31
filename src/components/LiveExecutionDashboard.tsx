import { useCallback, useState } from 'react';
import { Activity, CheckCircle2, Clock, RefreshCw, Wallet, XCircle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface Balance { asset: string; free: number; locked: number }
interface BinanceOrder {
  orderId: number;
  side: 'BUY' | 'SELL';
  type: string;
  status: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  time: number;
}
interface BinanceTrade { id: number; orderId: number; price: string; qty: string; quoteQty: string; commission: string; commissionAsset: string; isBuyer: boolean; time: number }
interface SymbolHistory { symbol: string; orders: BinanceOrder[]; trades: BinanceTrade[] }
interface AccountResponse { ok: true; balances: Balance[]; fetchedAt: string }
interface OrdersResponse { ok: true; symbols: SymbolHistory[]; fetchedAt: string }

const STATUS_STYLES: Record<string, string> = {
  FILLED: 'bg-emerald-500/15 text-emerald-400',
  PARTIALLY_FILLED: 'bg-amber-500/15 text-amber-400',
  NEW: 'bg-sky-500/15 text-sky-400',
  CANCELED: 'bg-zinc-700/40 text-zinc-400',
  REJECTED: 'bg-red-500/15 text-red-400',
  EXPIRED: 'bg-zinc-700/40 text-zinc-400',
};

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  FILLED: CheckCircle2,
  REJECTED: XCircle,
  CANCELED: XCircle,
  EXPIRED: XCircle,
};

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

export default function LiveExecutionDashboard() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<SymbolHistory[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [account, orders] = await Promise.all([
        operatorFetch('binance-account/account').then(readJson<AccountResponse>),
        operatorFetch('binance-account/orders').then(readJson<OrdersResponse>),
      ]);
      setBalances(account.balances);
      setHistory(orders.symbols);
      setFetchedAt(orders.fetchedAt);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Exchange data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityPolling(refresh, 15_000, true);

  const usdt = balances.find(b => b.asset === 'USDT');
  const allOrders = history
    .flatMap(h => h.orders.map(o => ({ ...o, symbol: h.symbol })))
    .sort((a, b) => b.time - a.time);

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-emerald-400" />
        <h2 className="text-base font-semibold text-zinc-200">Live Execution</h2>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {fetchedAt ? `Updated ${formatTime(new Date(fetchedAt).getTime())}` : 'Connecting to exchange'}
        </span>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
            <Wallet className="h-4 w-4 text-amber-400" /> Free USDT
          </div>
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">
            {usdt ? `$${formatMoney(usdt.free)}` : loading ? '...' : '$0.00'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 text-xs font-medium text-zinc-500">Orders shown</div>
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">{allOrders.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-2 text-xs font-medium text-zinc-500">Filled</div>
          <p className="text-2xl font-semibold tabular-nums text-emerald-400">
            {allOrders.filter(o => o.status === 'FILLED').length}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-4">
          <Clock className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-300">Recent Orders (BCH and LTC)</h3>
        </div>
        {allOrders.length === 0 && !loading ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">No orders found on the exchange for these coins.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Coin</th>
                  <th className="px-5 py-3 font-medium">Side</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Filled</th>
                  <th className="px-5 py-3 text-right font-medium">Value (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {allOrders.map(o => {
                  const StatusIcon = STATUS_ICONS[o.status] ?? Clock;
                  return (
                    <tr key={`${o.symbol}-${o.orderId}`} className="transition-colors hover:bg-zinc-800/40">
                      <td className="px-5 py-3 text-zinc-400">{formatTime(o.time)}</td>
                      <td className="px-5 py-3 font-medium text-zinc-200">{o.symbol.replace('USDT', '')}</td>
                      <td className={`px-5 py-3 font-medium ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.side}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[o.status] ?? 'bg-zinc-700/40 text-zinc-300'}`}>
                          <StatusIcon className="h-3 w-3" />
                          {o.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-300">{Number(o.executedQty).toFixed(4)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-300">${formatMoney(Number(o.cummulativeQuoteQty))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
