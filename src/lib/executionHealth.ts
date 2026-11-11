import type { ExecutionOrder } from './executionOrders.ts';

export interface ExchangeBalance { asset: string; free: number; locked: number }
export interface ReconciliationCandidate {
  id: string;
  symbol: string;
  quantity: number;
  closedAt: string;
  buyOrderId: string;
  exchangeBalance: number | null;
}

/** Only complete sell accounting belongs in the displayed P&L subtotal. */
export function summarizeExecution(orders: ExecutionOrder[]) {
  const sells = orders.filter(order => order.side === 'SELL' && order.executedQty > 0);
  const complete = sells.filter(order => order.pnl?.complete);
  return {
    realizedPnl: complete.reduce((sum, order) => sum + order.pnl!.realizedPnl, 0),
    incompleteSells: sells.length - complete.length,
    matchedSells: complete.length,
    openOrders: orders.filter(order => ['NEW', 'PARTIALLY_FILLED', 'PENDING_CANCEL'].includes(order.status)).length,
    filledOrders: orders.filter(order => order.status === 'FILLED').length,
  };
}

export function isSnapshotStale(fetchedAt: string | null, now: number, maxAgeMs = 90_000): boolean {
  if (!fetchedAt) return true;
  const time = Date.parse(fetchedAt);
  return !Number.isFinite(time) || now - time > maxAgeMs || time > now + 5_000;
}
