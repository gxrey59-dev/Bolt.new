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
}

export interface OrderPnl {
  realizedPnl: number;
  complete: boolean;
}

interface Lot {
  qty: number;
  unitCost: number;
}

function feeInQuote(trade: BinanceTrade, symbol: string): number {
  const commission = Number(trade.commission);
  if (!commission) return 0;
  const quoteAsset = symbol.slice(-4);
  const baseAsset = symbol.slice(0, -4);
  if (trade.commissionAsset === quoteAsset) return commission;
  if (trade.commissionAsset === baseAsset) return commission * Number(trade.price);
  return 0;
}

// FIFO matching of buy fills to sell fills. A sell's realized profit is attributed to the sell order.
// `complete` is false when a sell had more quantity than the fetched buy history covers.
export function computeRealizedPnl(symbol: string, trades: BinanceTrade[]): Map<number, OrderPnl> {
  const sorted = [...trades].sort((a, b) => a.time - b.time || a.id - b.id);
  const lots: Lot[] = [];
  const result = new Map<number, OrderPnl>();

  for (const trade of sorted) {
    const qty = Number(trade.qty);
    const quote = Number(trade.quoteQty);
    const fee = feeInQuote(trade, symbol);

    if (trade.isBuyer) {
      if (qty > 0) lots.push({ qty, unitCost: (quote + fee) / qty });
      continue;
    }

    let remaining = qty;
    let cost = 0;
    while (remaining > 1e-12 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.qty, remaining);
      cost += take * lot.unitCost;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-12) lots.shift();
    }

    const current = result.get(trade.orderId) ?? { realizedPnl: 0, complete: true };
    current.realizedPnl += quote - fee - cost;
    if (remaining > 1e-12) current.complete = false;
    result.set(trade.orderId, current);
  }

  return result;
}
