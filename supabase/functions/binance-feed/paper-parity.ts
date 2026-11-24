// Paper mode is only useful if it predicts live results. These rules keep the
// two modes on the same economics and decide, from evidence, when paper
// performance is good enough to consider risking money.

/** Estimated market-order slippage per side for paper fills (0.05%). */
export const DEFAULT_PAPER_SLIPPAGE_RATE = 0.0005;

/**
 * Realized P&L in both modes: gross minus the fee on both sides. Paper fills
 * also pay an estimated slippage, because they fill at the quoted price while
 * real market orders cross the spread.
 */
export function bookedPnl(
  grossPnl: number, entryPrice: number, exitPrice: number, qty: number,
  opts: { isLive: boolean; feeRate: number; paperSlippageRate?: number },
): number {
  const notional = (entryPrice + exitPrice) * qty;
  const slippage = opts.isLive ? 0 : opts.paperSlippageRate ?? DEFAULT_PAPER_SLIPPAGE_RATE;
  return grossPnl - notional * (opts.feeRate + slippage);
}

export interface ClosedTrade { pnl: number; positionValue: number; closedAt: string }

export interface ReadinessCriteria {
  minTrades: number;          // sample size before any verdict
  minProfitFactor: number;    // gross wins / gross losses, net of costs
  minReturnPerTradePct: number; // average net return per trade, % of notional
  maxDrawdownPct: number;     // worst peak-to-trough of cumulative P&L, % of capital
}

export const DEFAULT_READINESS: ReadinessCriteria = {
  minTrades: 200,
  minProfitFactor: 1.3,
  minReturnPerTradePct: 0.15,
  maxDrawdownPct: 15,
};

export interface ReadinessReport {
  ready: boolean;
  trades: number;
  netPnl: number;
  profitFactor: number | null;
  returnPerTradePct: number;
  maxDrawdownPct: number;
  reasons: string[];
}

/**
 * Evaluate paper trades recorded under live-parity rules. "Ready" means the
 * evidence clears every bar, not that future profit is assured.
 */
export function liveReadiness(trades: ClosedTrade[], capital: number, criteria: ReadinessCriteria = DEFAULT_READINESS): ReadinessReport {
  const ordered = [...trades].sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  let wins = 0, losses = 0, cumulative = 0, peak = 0, worst = 0, notional = 0;
  for (const t of ordered) {
    if (t.pnl > 0) wins += t.pnl; else losses -= t.pnl;
    notional += t.positionValue;
    cumulative += t.pnl;
    peak = Math.max(peak, cumulative);
    worst = Math.max(worst, peak - cumulative);
  }
  const profitFactor = losses > 0 ? wins / losses : wins > 0 ? Infinity : null;
  const returnPerTradePct = ordered.length && notional > 0 ? (cumulative / notional) * 100 : 0;
  const maxDrawdownPct = capital > 0 ? (worst / capital) * 100 : 0;

  const reasons: string[] = [];
  if (ordered.length < criteria.minTrades) reasons.push(`Only ${ordered.length} of ${criteria.minTrades} required trades`);
  if (profitFactor === null || profitFactor < criteria.minProfitFactor) reasons.push(`Profit factor ${profitFactor === null ? 'n/a' : profitFactor.toFixed(2)} below ${criteria.minProfitFactor}`);
  if (returnPerTradePct < criteria.minReturnPerTradePct) reasons.push(`Net return per trade ${returnPerTradePct.toFixed(3)}% below ${criteria.minReturnPerTradePct}%`);
  if (maxDrawdownPct > criteria.maxDrawdownPct) reasons.push(`Max drawdown ${maxDrawdownPct.toFixed(1)}% above ${criteria.maxDrawdownPct}%`);

  return { ready: reasons.length === 0, trades: ordered.length, netPnl: cumulative, profitFactor, returnPerTradePct, maxDrawdownPct, reasons };
}
