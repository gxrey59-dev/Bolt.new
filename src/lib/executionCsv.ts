import type { ExecutionOrder } from '@/lib/executionOrders';
import type { SymbolHistory } from '@/lib/tradePnl';

interface Balance { asset: string; free: number; locked: number }

type Cell = string | number | null;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: Cell): string {
  if (value === null) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toLine(cells: Cell[]): string {
  return cells.map(escapeCell).join(',');
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

export function buildExecutionCsv(
  balances: Balance[],
  orders: ExecutionOrder[],
  histories: SymbolHistory[],
  exportedAt: string,
): string {
  const lines: string[] = [];

  lines.push(toLine(['Exported at', exportedAt]));
  lines.push('');

  lines.push(toLine(['BALANCES']));
  lines.push(toLine(['Asset', 'Free', 'Locked']));
  for (const b of balances) lines.push(toLine([b.asset, b.free, b.locked]));
  lines.push('');

  lines.push(toLine(['ORDERS']));
  lines.push(toLine(['Order ID', 'Time (UTC)', 'Coin', 'Pair', 'Faction', 'Side', 'Status', 'Filled quantity', 'Value (USDT)', 'Realized P&L (USDT)', 'P&L complete']));
  for (const o of orders) {
    lines.push(toLine([
      o.orderId,
      isoTime(o.time),
      o.coin,
      o.symbol,
      o.faction,
      o.side,
      o.status,
      o.executedQty,
      o.quoteValue,
      o.pnl ? o.pnl.realizedPnl.toFixed(4) : null,
      o.pnl ? (o.pnl.complete ? 'yes' : 'no') : null,
    ]));
  }
  lines.push('');

  lines.push(toLine(['FILLS']));
  lines.push(toLine(['Trade ID', 'Order ID', 'Time (UTC)', 'Pair', 'Side', 'Price', 'Quantity', 'Quote quantity', 'Commission', 'Commission asset']));
  for (const h of histories) {
    for (const t of h.trades) {
      lines.push(toLine([
        t.id,
        t.orderId,
        isoTime(t.time),
        h.symbol,
        t.isBuyer ? 'BUY' : 'SELL',
        t.price,
        t.qty,
        t.quoteQty,
        t.commission,
        t.commissionAsset,
      ]));
    }
  }

  return lines.join('\r\n');
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
