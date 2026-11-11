export interface BinanceOrder {
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

export interface BinanceTrade {
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  isBuyer: boolean;
  time: number;
}

export interface SymbolHistory {
  symbol: string;
  orders: BinanceOrder[];
  trades: BinanceTrade[];
  tradesMayBeTruncated?: boolean;
  ordersMayBeTruncated?: boolean;
}

export interface OrderPnl {
  realizedPnl: number;
  complete: boolean;
}

interface Lot {
  qty: number;
  unitCost: number;
}

// FIFO accounting for the fetched fill window. Base-asset fees reduce inventory;
// third-asset fees cannot be valued without a historical conversion rate.
export function computeRealizedPnl(symbol: string, trades: BinanceTrade[]): Map<number, OrderPnl> {
  const sorted = [...trades].sort((a, b) => a.time - b.time || a.id - b.id);
  const lots: Array<Lot & { complete: boolean }> = [];
  const result = new Map<number, OrderPnl>();
  const quoteAsset = symbol.endsWith('USDT') ? 'USDT' : '';
  const baseAsset = symbol.slice(0, -quoteAsset.length);
  const seen = new Set<number>();
  let historyValid = true;

  for (const trade of sorted) {
    if (seen.has(trade.id)) continue;
    seen.add(trade.id);
    const qty = Number(trade.qty);
    const quote = Number(trade.quoteQty);
    const commission = Number(trade.commission);
    if (![qty, quote, commission].every(Number.isFinite) || qty <= 0 || quote < 0 || commission < 0) {
      historyValid = false;
      if (!trade.isBuyer) result.set(trade.orderId, { realizedPnl: 0, complete: false });
      continue;
    }
    const baseFee = trade.commissionAsset === baseAsset ? commission : 0;
    const quoteFee = trade.commissionAsset === quoteAsset ? commission : 0;
    const feeKnown = commission === 0 || trade.commissionAsset === quoteAsset || trade.commissionAsset === baseAsset;

    if (trade.isBuyer) {
      const receivedQty = qty - baseFee;
      if (receivedQty > 0) lots.push({ qty: receivedQty, unitCost: (quote + quoteFee) / receivedQty, complete: feeKnown });
      continue;
    }

    let remaining = qty + baseFee;
    let cost = 0;
    let complete = feeKnown && historyValid;
    while (remaining > 1e-12 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.qty, remaining);
      cost += take * lot.unitCost;
      complete = complete && lot.complete;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-12) lots.shift();
    }

    const current = result.get(trade.orderId) ?? { realizedPnl: 0, complete: true };
    current.realizedPnl += quote - quoteFee - cost;
    current.complete = current.complete && complete && remaining <= 1e-12;
    result.set(trade.orderId, current);
  }
  return result;
}
