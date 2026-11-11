export interface ClosePositionsResult {
  closedByRules: number;
  forceClosed: number;
  total: number;
  failed: number;
  remainingOpen: number;
  failures: { tradeId: string; symbol: string; error: string }[];
  complete: boolean;
}

export async function readTradingResponse(res: Response): Promise<Record<string, unknown>> {
  const body: unknown = await res.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Trading service returned an invalid response (HTTP ${res.status}).`);
  }
  const data = body as Record<string, unknown>;
  if (!res.ok || typeof data.error === 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : `Trading service returned HTTP ${res.status}.`);
  }
  return data;
}

/** Legacy responses cannot prove all requested sales succeeded. */
export function parseClosePositionsResult(data: Record<string, unknown>): ClosePositionsResult {
  const counts = ['closedByRules', 'forceClosed', 'total', 'failed', 'remainingOpen'] as const;
  if (counts.some(key => !Number.isSafeInteger(data[key]) || Number(data[key]) < 0)
    || typeof data.complete !== 'boolean' || !Array.isArray(data.failures)
    || data.total !== Number(data.closedByRules) + Number(data.forceClosed)
    || data.complete !== (data.failed === 0 && data.remainingOpen === 0)
    || data.failures.some(failure => !failure || typeof failure !== 'object'
      || typeof failure.tradeId !== 'string' || typeof failure.symbol !== 'string' || typeof failure.error !== 'string')) {
    throw new Error('Close request returned without reliable completion details. Refresh positions and verify exchange orders before retrying.');
  }
  return data as unknown as ClosePositionsResult;
}

export function describeClosePositions(result: ClosePositionsResult): string {
  const completed = `${result.total} position${result.total === 1 ? '' : 's'} closed.`;
  if (result.complete) return `${completed} No tracked positions remain open.`;
  return `${completed} ${result.failed} close${result.failed === 1 ? '' : 's'} failed; ${result.remainingOpen} remain open. ${result.failures.map(f => `${f.symbol}: ${f.error}`).join(' ')}`;
}

interface ValuedPosition {
  unrealized_pnl: number | null;
  runner_pnl?: number | null;
  partial_pnl?: number;
  price_available?: boolean;
}

/** Partial-exit profit is realized and must not be added to open-position P&L. */
export function positionUnrealizedPnl(position: ValuedPosition): number | null {
  if (position.price_available === false) return null;
  const value = position.runner_pnl !== undefined
    ? position.runner_pnl
    : position.unrealized_pnl === null ? null : position.unrealized_pnl - (position.partial_pnl ?? 0);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function totalPositionPnl(positions: ValuedPosition[]): number | null {
  let sum = 0;
  for (const position of positions) {
    const value = positionUnrealizedPnl(position);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

export function recordedTradeStats(history: { pnl: number }[]) {
  const values = history.map(t => Number(t.pnl)).filter(Number.isFinite);
  const gains = values.filter(pnl => pnl > 0);
  const losses = values.filter(pnl => pnl < 0);
  const grossProfit = gains.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = -losses.reduce((sum, pnl) => sum + pnl, 0);
  return {
    total: grossProfit - grossLoss,
    wins: gains.length,
    losses: losses.length,
    breakeven: values.length - gains.length - losses.length,
    winRate: values.length > 0 ? gains.length / values.length * 100 : null,
    avgWin: gains.length ? grossProfit / gains.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
  };
}
