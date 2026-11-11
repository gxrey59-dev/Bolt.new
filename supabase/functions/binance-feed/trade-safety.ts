export interface ExchangeOrderResult {
  orderId: string | null;
  error: string | null;
  status?: string;
  submittedQuantity?: number;
  executedQuantity?: number;
  averagePrice?: number;
  claimToken?: string;
  skipFailureWrite?: boolean;
  definitiveRejection?: boolean;
}

export const RECONCILIATION_REQUIRED = "Reconciliation required:";

export function isDefinitiveOrderRejection(status: number, body: string): boolean {
  if (status < 400 || status >= 500 || status === 408) return false;
  try {
    const code = (JSON.parse(body) as { code?: unknown }).code;
    // Binance explicitly documents unknown execution status for these failures.
    return typeof code === "number" && code < 0 && ![-1000, -1001, -1006, -1007].includes(code);
  } catch {
    return false;
  }
}

export function entryClientOrderId(attemptId: string, compensation = false): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) {
    throw new Error("Invalid entry attempt ID");
  }
  return `${compensation ? "c" : "e"}${attemptId.replaceAll("-", "")}`;
}

/** A failed insert response never authorizes an automatic compensating trade. */
export function recoverEntryTracking(tradeId: string | null, detail: string) {
  return tradeId
    ? { tradeId, error: null }
    : { tradeId: null, error: `${RECONCILIATION_REQUIRED} entry filled but database tracking needs review: ${detail}` };
}

export async function runClaimedEntry(options: {
  attemptId: string;
  claim: () => Promise<boolean>;
  submit: (clientOrderId: string) => Promise<ExchangeOrderResult>;
  settleFailure: (state: "rejected" | "reconciliation_required", result: ExchangeOrderResult) => Promise<void>;
}): Promise<ExchangeOrderResult> {
  const clientOrderId = entryClientOrderId(options.attemptId);
  try {
    if (!await options.claim()) return { orderId: null, error: "Live entry already pending for this symbol", skipFailureWrite: true };
  } catch (error) {
    return { orderId: null, error: `Entry claim failed: ${error instanceof Error ? error.message : String(error)}`, skipFailureWrite: true };
  }
  let result: ExchangeOrderResult;
  try { result = await options.submit(clientOrderId); }
  catch (error) {
    result = { orderId: null, error: `${RECONCILIATION_REQUIRED} entry outcome unknown: ${error instanceof Error ? error.message : String(error)}` };
  }
  result = { ...result, claimToken: options.attemptId, error: exitConfirmationError(result)?.replaceAll("close order", "entry order") ?? null };
  if (result.error) {
    await options.settleFailure(result.definitiveRejection ? "rejected" : "reconciliation_required", result);
  }
  // A confirmed fill keeps its claim until the position is durably tracked.
  return result;
}

/** Persist the claim before submitting, and retain it when execution is ambiguous. */
export async function runClaimedExit(options: {
  quantity: number;
  claimToken: string;
  claim: () => Promise<boolean>;
  submit: () => Promise<ExchangeOrderResult>;
}): Promise<ExchangeOrderResult> {
  try {
    if (!await options.claim()) {
      return { orderId: null, error: "Position changed or another exit is already in progress", skipFailureWrite: true };
    }
  } catch (error) {
    return { orderId: null, error: `Exit claim failed: ${error instanceof Error ? error.message : String(error)}`, skipFailureWrite: true };
  }
  try {
    const result = await options.submit();
    return { ...result, claimToken: options.claimToken, error: exitConfirmationError(result, options.quantity) };
  } catch (error) {
    return {
      orderId: null, claimToken: options.claimToken,
      error: `${RECONCILIATION_REQUIRED} close outcome unknown: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function parseOrderReceipt(data: Record<string, unknown>, submittedQuantity: number): ExchangeOrderResult {
  const rawId = data.orderId;
  const orderId = (typeof rawId === "string" && /^\d+$/.test(rawId) && Number(rawId) > 0)
    || (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0)
    ? String(rawId) : null;
  const executedQuantity = Number(data.executedQty);
  const quoteQuantity = Number(data.cummulativeQuoteQty);
  return {
    orderId,
    error: orderId ? null : `${RECONCILIATION_REQUIRED} exchange returned no valid order ID`,
    status: typeof data.status === "string" ? data.status : undefined,
    submittedQuantity,
    executedQuantity,
    averagePrice: executedQuantity > 0 && Number.isFinite(quoteQuantity) && quoteQuantity > 0
      ? quoteQuantity / executedQuantity : undefined,
  };
}

/** An accepted order is not proof that the position was sold. */
export function exitConfirmationError(result: ExchangeOrderResult, positionQuantity?: number): string | null {
  if (result.error) return result.error;
  if (!result.orderId) return `${RECONCILIATION_REQUIRED} exchange returned no close order ID`;
  if (result.status !== "FILLED") {
    return `${RECONCILIATION_REQUIRED} close order ${result.orderId} status is ${result.status ?? "unknown"}`;
  }
  const requested = result.submittedQuantity;
  const executed = result.executedQuantity;
  if (!Number.isFinite(requested) || !Number.isFinite(executed) || !requested || !executed
    || requested <= 0 || executed <= 0 || Math.abs(executed - requested) > requested * 1e-8) {
    return `${RECONCILIATION_REQUIRED} close order ${result.orderId} has unconfirmed execution quantity`;
  }
  if (positionQuantity !== undefined && (!Number.isFinite(positionQuantity) || positionQuantity <= 0
    || Math.abs(executed - positionQuantity) > Math.max(1e-12, positionQuantity * 1e-8))) {
    return `${RECONCILIATION_REQUIRED} close order ${result.orderId} filled ${executed} of ${positionQuantity}; remaining inventory must be reconciled`;
  }
  if (!Number.isFinite(result.averagePrice) || !result.averagePrice || result.averagePrice <= 0) {
    return `${RECONCILIATION_REQUIRED} close order ${result.orderId} has no confirmed fill price`;
  }
  return null;
}

export function liveExitBlockReason(trade: { binance_order_id?: unknown; execution_error?: unknown }): string | null {
  if (typeof trade.execution_error === "string" && trade.execution_error.startsWith(RECONCILIATION_REQUIRED)) {
    return trade.execution_error;
  }
  if (!trade.binance_order_id || trade.binance_order_id === "undefined" || trade.binance_order_id === "null") {
    return "Live close blocked: entry order ID is missing";
  }
  return null;
}

interface PositionRecord {
  symbol: string;
  side: string;
  entry_price: number | string;
  quantity: number | string;
  remaining_quantity?: number | string | null;
  position_value: number | string;
  partial_exit_pnl?: number | string | null;
  partial_exit_price?: number | string | null;
  peak_price?: number | string | null;
}

export function valueOpenPosition<T extends PositionRecord>(trade: T, quote: number | undefined) {
  const currentPrice = quote !== undefined && Number.isFinite(quote) && quote > 0 ? quote : null;
  const entry = Number(trade.entry_price);
  const remaining = Number(trade.remaining_quantity ?? trade.quantity);
  const partial = Number(trade.partial_exit_pnl ?? 0);
  const peak = Number(trade.peak_price ?? trade.entry_price);
  const direction = trade.side === "long" ? 1 : -1;
  const runner = currentPrice === null ? null : (currentPrice - entry) * remaining * direction;
  const total = runner === null ? null : runner + partial;
  const positionValue = Number(trade.position_value);
  return {
    ...trade,
    current_price: currentPrice,
    price_available: currentPrice !== null,
    unrealized_pnl: total,
    runner_pnl: runner,
    partial_pnl: partial,
    pnl_pct: total === null || positionValue <= 0 ? null : total / positionValue * 100,
    peak_price: peak,
    peak_pnl: (peak - entry) * remaining * direction + partial,
    has_partial_exit: trade.partial_exit_price != null,
    remaining_quantity: remaining,
  };
}
