import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Search, XCircle } from 'lucide-react';
import {
  filterAndSortOrders,
  STATUS_GROUP_LABELS,
  type ExecutionOrder,
  type SortDir,
  type SortKey,
  type StatusGroup,
} from '@/lib/executionOrders';

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

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'coin', label: 'Coin' },
  { key: 'faction', label: 'Faction' },
  { key: 'status', label: 'Status' },
  { key: 'pnl', label: 'Profit & loss' },
];

const STATUS_FILTERS: StatusGroup[] = ['all', 'filled', 'partial', 'open', 'rejected', 'canceled'];

function formatMoney(value: number, digits = 2) {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PnlCell({ order }: { order: ExecutionOrder }) {
  if (!order.pnl) return <span className="text-zinc-600">{order.side === 'BUY' ? 'Entry' : '-'}</span>;
  const value = order.pnl.realizedPnl;
  const tone = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-zinc-300';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return (
    <span className={`tabular-nums font-medium ${tone}`} title={order.pnl.complete ? undefined : 'Some buy history was outside the fetched window'}>
      {sign}${formatMoney(Math.abs(value))}
      {order.pnl.complete ? null : <span className="ml-1 text-amber-400">*</span>}
    </span>
  );
}

interface Props {
  orders: ExecutionOrder[];
  loading: boolean;
}

export default function ExecutionOrdersTable({ orders, loading }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusGroup>('all');
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const rows = useMemo(
    () => filterAndSortOrders(orders, { query, status, sortKey, sortDir }),
    [orders, query, status, sortKey, sortDir],
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex flex-col gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-300">Orders</h3>
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search coin, faction, status"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                status === s ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {STATUS_GROUP_LABELS[s]}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="execution-sort" className="text-xs text-zinc-500">Sort by</label>
            <select
              id="execution-sort"
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-600"
            >
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          {loading ? 'Loading orders...' : orders.length === 0 ? 'No orders found on the exchange for these coins.' : 'No orders match your search or filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Coin</th>
                <th className="px-5 py-3 font-medium">Faction</th>
                <th className="px-5 py-3 font-medium">Side</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Filled</th>
                <th className="px-5 py-3 text-right font-medium">Value (USDT)</th>
                <th className="px-5 py-3 text-right font-medium">Realized P&amp;L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map(o => {
                const StatusIcon = STATUS_ICONS[o.status] ?? Clock;
                return (
                  <tr key={`${o.symbol}-${o.orderId}`} className="transition-colors hover:bg-zinc-800/40">
                    <td className="px-5 py-3 text-zinc-400">{formatTime(o.time)}</td>
                    <td className="px-5 py-3 font-medium text-zinc-200">{o.coin}</td>
                    <td className="px-5 py-3 text-zinc-300">{o.faction ?? <span className="text-zinc-600">Unknown</span>}</td>
                    <td className={`px-5 py-3 font-medium ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.side}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[o.status] ?? 'bg-zinc-700/40 text-zinc-300'}`}>
                        <StatusIcon className="h-3 w-3" />
                        {o.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-300">{o.executedQty.toFixed(4)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-300">${formatMoney(o.quoteValue)}</td>
                    <td className="px-5 py-3 text-right"><PnlCell order={o} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.some(o => o.pnl && !o.pnl.complete) ? (
        <p className="border-t border-zinc-800 px-5 py-3 text-[11px] text-zinc-500">
          * Some sells matched buys older than the fetched history, so their profit may be incomplete.
        </p>
      ) : null}
    </div>
  );
}
