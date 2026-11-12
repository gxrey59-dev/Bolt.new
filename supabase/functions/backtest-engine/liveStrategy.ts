export interface Candle { open: number; high: number; low: number; close: number; volume: number; }

export interface LiveConfig {
  stopLossPct: number;
  takeProfitPct: number;
  maxPositionPct: number;
  feePct: number;
  startingCapital: number;
}

export interface LiveRange { from: number; to: number; }

export interface LiveTrade {
  symbol: string; side: "long" | "short"; entryPrice: number; exitPrice: number;
  pnl: number; exitReason: string; holdBars: number;
}

export interface LiveResult {
  finalEquity: number; totalReturnPct: number; maxDrawdownPct: number;
  totalTrades: number; winRate: number; avgWin: number; avgLoss: number; profitFactor: number;
  trades: LiveTrade[];
}

const MIN_CONFLUENCE = 4.5;
const MAX_HOLD_BARS = 48;

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let v = values[0];
  for (let i = 1; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(candles: Candle[], period = 14): number {
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  return sum / period;
}

function macdHistogram(closes: number[]): { line: number; signal: number; histogram: number } {
  const e12: number[] = [closes[0]];
  const e26: number[] = [closes[0]];
  const k12 = 2 / 13, k26 = 2 / 27;
  for (let i = 1; i < closes.length; i++) {
    e12.push(closes[i] * k12 + e12[i - 1] * (1 - k12));
    e26.push(closes[i] * k26 + e26[i - 1] * (1 - k26));
  }
  const macd = closes.map((_, i) => e12[i] - e26[i]);
  const k9 = 2 / 10;
  let sig = macd[0];
  for (let i = 1; i < macd.length; i++) sig = macd[i] * k9 + sig * (1 - k9);
  const line = macd[macd.length - 1];
  return { line, signal: sig, histogram: line - sig };
}

// Mirrors the live confluence factors in binance-feed: long needs a bullish score of at least 4.5 with an uptrend.
export function confluenceSignal(candles: Candle[]): "long" | "short" | null {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const r = rsi(closes);
  const prevR = rsi(closes.slice(0, -1));
  const m = macdHistogram(closes);
  const ema12 = ema(closes.slice(-60), 12), ema26 = ema(closes.slice(-60), 26);
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50);
  const mean = sma(closes, 20);
  const sd = Math.sqrt(closes.slice(-20).reduce((s, v) => s + (v - mean) ** 2, 0) / 20);
  const bbUpper = mean + 2 * sd, bbLower = mean - 2 * sd;
  const volAvg = sma(candles.map((c) => c.volume), 20);
  const volRatio = volAvg > 0 ? candles[candles.length - 1].volume / volAvg : 1;
  const priceUp = price > prevClose;
  const mom = ((price - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;

  let longScore = 0, shortScore = 0;
  if (r <= 30) longScore += 1.5; else if (r >= 70) shortScore += 1.5;
  if (r > prevR && r <= 40) longScore += 1; else if (r < prevR && r >= 60) shortScore += 1;
  if (m.histogram > 0 && m.line > m.signal) longScore += 1.5; else if (m.histogram < 0 && m.line < m.signal) shortScore += 1.5;
  if (ema12 > ema26 && sma20 > sma50) longScore += 2; else if (ema12 < ema26 && sma20 < sma50) shortScore += 2;
  if (price <= bbLower) longScore += 1; else if (price >= bbUpper) shortScore += 1;
  if (volRatio > 1.5) { if (priceUp) longScore += 0.5; else shortScore += 0.5; }
  if (mom > 1 && ema12 > ema26) longScore += 1; else if (mom < -1 && ema12 < ema26) shortScore += 1;
  if (price > sma50) longScore += 1; else if (price < sma50) shortScore += 1;

  const isUptrend = price > sma50 && ema12 > ema26;
  const isDowntrend = price < sma50 && ema12 < ema26;
  if (longScore >= MIN_CONFLUENCE && longScore > shortScore && isUptrend) return "long";
  if (shortScore >= MIN_CONFLUENCE && shortScore > longScore && isDowntrend) return "short";
  return null;
}

interface OpenPosition {
  symbol: string; side: "long" | "short"; entryPrice: number; quantity: number;
  entryBar: number; stop: number; target: number; peak: number; partialDone: boolean; partialPnl: number;
  partialQty: number;
}

export function simulateLive(
  series: Map<string, Candle[]>,
  range: LiveRange,
  cfg: LiveConfig,
): LiveResult {
  const symbols = Array.from(series.keys());
  let equity = cfg.startingCapital;
  let peak = equity, maxDd = 0;
  const open: OpenPosition[] = [];
  const trades: LiveTrade[] = [];
  const fee = cfg.feePct / 100;

  const closeAll = (pos: OpenPosition, exitPrice: number, qty: number, reason: string, bar: number) => {
    const gross = pos.side === "long" ? (exitPrice - pos.entryPrice) * qty : (pos.entryPrice - exitPrice) * qty;
    const notional = pos.entryPrice * qty;
    const pnl = gross - fee * (notional + exitPrice * qty);
    equity += notional + pnl;
    trades.push({ symbol: pos.symbol, side: pos.side, entryPrice: pos.entryPrice, exitPrice, pnl, exitReason: reason, holdBars: bar - pos.entryBar });
  };

  for (let bar = range.from; bar < range.to; bar++) {
    for (let i = open.length - 1; i >= 0; i--) {
      const pos = open[i];
      const c = series.get(pos.symbol)![bar];
      const isLong = pos.side === "long";
      const profitPct = isLong ? ((c.close - pos.entryPrice) / pos.entryPrice) * 100 : ((pos.entryPrice - c.close) / pos.entryPrice) * 100;
      if (isLong) pos.peak = Math.max(pos.peak, c.high); else pos.peak = Math.min(pos.peak, c.low);
      const trailPct = pos.partialDone ? 1.2 : 2.0;
      if (profitPct >= 3) {
        const ns = isLong ? pos.peak * (1 - trailPct / 100) : pos.peak * (1 + trailPct / 100);
        if (isLong ? ns > pos.stop : ns < pos.stop) pos.stop = ns;
      } else if (profitPct >= 1.5) {
        if (isLong ? pos.entryPrice > pos.stop : pos.entryPrice < pos.stop) pos.stop = pos.entryPrice;
      }

      const stopHit = isLong ? c.low <= pos.stop : c.high >= pos.stop;
      const targetHit = isLong ? c.high >= pos.target : c.low <= pos.target;
      const timeout = bar - pos.entryBar >= MAX_HOLD_BARS;
      if (stopHit) {
        closeAll(pos, pos.stop, pos.quantity - pos.partialQty, "stop", bar);
        open.splice(i, 1);
      } else if (targetHit && !pos.partialDone) {
        const partialQty = pos.quantity * 0.5;
        const notional = pos.entryPrice * partialQty;
        const gross = isLong ? (pos.target - pos.entryPrice) * partialQty : (pos.entryPrice - pos.target) * partialQty;
        const pnl = gross - fee * (notional + pos.target * partialQty);
        equity += notional + pnl;
        pos.partialDone = true;
        pos.partialQty = partialQty;
        pos.partialPnl = pnl;
        trades.push({ symbol: pos.symbol, side: pos.side, entryPrice: pos.entryPrice, exitPrice: pos.target, pnl, exitReason: "partial_tp", holdBars: bar - pos.entryBar });
      } else if (targetHit && pos.partialDone) {
        closeAll(pos, pos.target, pos.quantity - pos.partialQty, "take_profit", bar);
        open.splice(i, 1);
      } else if (timeout) {
        closeAll(pos, c.close, pos.quantity - pos.partialQty, "time_exit", bar);
        open.splice(i, 1);
      }
    }

    if (bar >= range.from) {
      for (const sym of symbols) {
        if (open.some((p) => p.symbol === sym)) continue;
        const candles = series.get(sym)!.slice(Math.max(0, bar - 99), bar + 1);
        if (candles.length < 60 || equity <= 10) continue;
        const side = confluenceSignal(candles);
        if (!side) continue;
        const price = candles[candles.length - 1].close;
        const notional = equity * (cfg.maxPositionPct / 100);
        const quantity = notional / price;
        const isLong = side === "long";
        const atrPct = (atr(candles) / price) * 100;
        const stopPct = Math.max(cfg.stopLossPct, Math.min(atrPct * 1.5, 5));
        const tpPct = Math.max(cfg.takeProfitPct, stopPct * 3);
        equity -= notional;
        open.push({
          symbol: sym, side, entryPrice: price, quantity, entryBar: bar,
          stop: isLong ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100),
          target: isLong ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100),
          peak: price, partialDone: false, partialPnl: 0, partialQty: 0,
        });
      }
    }

    const mark = equity + open.reduce((s, p) => {
      const c = series.get(p.symbol)![bar].close;
      return s + ((p.side === "long" ? c - p.entryPrice : p.entryPrice - c) * (p.quantity - p.partialQty));
    }, 0);
    if (mark > peak) peak = mark;
    const dd = ((peak - mark) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  const last = range.to - 1;
  for (const pos of [...open]) {
    closeAll(pos, series.get(pos.symbol)![last].close, pos.quantity - pos.partialQty, "end_of_test", last);
  }

  const wins = trades.filter((t) => t.pnl >= 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const lossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    finalEquity: equity,
    totalReturnPct: ((equity - cfg.startingCapital) / cfg.startingCapital) * 100,
    maxDrawdownPct: maxDd,
    totalTrades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgWin: wins.length ? winPnl / wins.length : 0,
    avgLoss: losses.length ? lossPnl / losses.length : 0,
    profitFactor: lossPnl > 0 ? winPnl / lossPnl : 0,
    trades,
  };
}
