export interface RevenueTrade {
  id: string;
  faction_id: string;
  symbol: string;
  pnl: number | string | null;
  status: string;
  is_live?: boolean;
  accounting_verified?: boolean;
  opened_at: string;
  closed_at: string | null;
}

export function numericAmount(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function isVerifiedClose(trade: RevenueTrade): boolean {
  return trade.is_live === true && trade.status === 'closed' && trade.accounting_verified === true
    && numericAmount(trade.pnl) !== null && !!trade.closed_at && Number.isFinite(Date.parse(trade.closed_at));
}

/** Only closed live records with explicit accounting verification contribute to verified P&L. */
export function summarizeRevenue(trades: RevenueTrade[], since: number, until = Date.now()) {
  const closed = trades.filter(t => t.is_live === true && t.status === 'closed' && t.closed_at
    && Date.parse(t.closed_at) >= since && Date.parse(t.closed_at) <= until);
  const verified = closed.filter(isVerifiedClose);
  const pending = closed.filter(t => !isVerifiedClose(t));
  const values = verified.map(t => Number(t.pnl));
  const wins = values.filter(p => p > 0);
  const losses = values.filter(p => p < 0);
  return {
    verified, pending,
    verifiedPnl: values.reduce((sum, pnl) => sum + pnl, 0),
    wins: wins.length,
    losses: losses.length,
    breakeven: values.filter(p => p === 0).length,
    winRate: values.length ? wins.length / values.length * 100 : null,
    averageWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null,
    averageLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null,
    openCount: trades.filter(t => t.is_live === true && t.status === 'open').length,
  };
}

export function utcDayStart(now = Date.now()): number {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatRevenue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
