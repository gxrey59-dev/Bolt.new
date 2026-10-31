import type { BinanceOrder, BinanceTrade, OrderPnl, SymbolHistory } from '@/lib/tradePnl';
import { computeRealizedPnl } from '@/lib/tradePnl';

export interface ExecutionOrder {
  orderId: number;
  symbol: string;
  coin: string;
  faction: string | null;
  side: 'BUY' | 'SELL';
  status: string;
  time: number;
  executedQty: number;
  quoteValue: number;
  pnl: OrderPnl | null;
}

export type StatusGroup = 'all' | 'filled' | 'partial' | 'open' | 'rejected' | 'canceled';
export type SortKey = 'time' | 'coin' | 'faction' | 'status' | 'pnl';
export type SortDir = 'asc' | 'desc';

export interface OrderFilter {
  query: string;
  status: StatusGroup;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  all: 'All',
  filled: 'Filled',
  partial: 'Partially filled',
  open: 'Open',
  rejected: 'Rejected',
  canceled: 'Canceled',
};

export function statusGroup(status: string): Exclude<StatusGroup, 'all'> {
  if (status === 'FILLED') return 'filled';
  if (status === 'PARTIALLY_FILLED') return 'partial';
  if (status === 'NEW') return 'open';
  if (status === 'REJECTED') return 'rejected';
  return 'canceled';
}

export function buildExecutionOrders(
  histories: SymbolHistory[],
  factionByOrderId: Map<number, string>,
): ExecutionOrder[] {
  return histories.flatMap(history => {
    const pnlByOrder = computeRealizedPnl(history.symbol, history.trades as BinanceTrade[]);
    return history.orders.map((order: BinanceOrder): ExecutionOrder => ({
      orderId: order.orderId,
      symbol: history.symbol,
      coin: history.symbol.slice(0, -4),
      faction: factionByOrderId.get(order.orderId) ?? null,
      side: order.side,
      status: order.status,
      time: order.time,
      executedQty: Number(order.executedQty),
      quoteValue: Number(order.cummulativeQuoteQty),
      pnl: order.side === 'SELL' ? pnlByOrder.get(order.orderId) ?? null : null,
    }));
  });
}

export function filterAndSortOrders(orders: ExecutionOrder[], filter: OrderFilter): ExecutionOrder[] {
  const needle = filter.query.trim().toLowerCase();
  const matches = orders.filter(o => {
    if (filter.status !== 'all' && statusGroup(o.status) !== filter.status) return false;
    if (!needle) return true;
    return [o.coin, o.faction ?? '', o.status, String(o.orderId)].some(v => v.toLowerCase().includes(needle));
  });

  const direction = filter.sortDir === 'asc' ? 1 : -1;
  const valueOf = (o: ExecutionOrder): number | string => {
    switch (filter.sortKey) {
      case 'coin': return o.coin;
      case 'faction': return o.faction ?? '';
      case 'status': return o.status;
      case 'pnl': return o.pnl?.realizedPnl ?? Number.NEGATIVE_INFINITY;
      default: return o.time;
    }
  };

  return matches.sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va < vb) return -1 * direction;
    if (va > vb) return 1 * direction;
    return 0;
  });
}
