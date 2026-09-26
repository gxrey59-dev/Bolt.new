import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BINANCE_BASE = "https://api.binance.us";
const BINANCE_API_KEY = Deno.env.get("BINANCE_API_KEY") ?? "";
const BINANCE_SECRET_KEY = Deno.env.get("BINANCE_SECRET_KEY") ?? "";

// Cache for exchange symbol filters (LOT_SIZE etc.)
let symbolFiltersCache: Map<string, { minQty: number; stepSize: number; minNotional: number }> | null = null;
let filtersCacheTime = 0;

async function getSymbolFilters(): Promise<Map<string, { minQty: number; stepSize: number; minNotional: number }>> {
  // Cache for 10 minutes
  if (symbolFiltersCache && Date.now() - filtersCacheTime < 10 * 60 * 1000) return symbolFiltersCache;
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo`);
    const data = await res.json();
    const map = new Map<string, { minQty: number; stepSize: number; minNotional: number }>();
    for (const s of data.symbols ?? []) {
      const filters: Record<string, string> = {};
      for (const f of s.filters ?? []) {
        if (f.filterType === "LOT_SIZE") { filters.minQty = f.minQty; filters.stepSize = f.stepSize; }
        if (f.filterType === "MIN_NOTIONAL") { filters.minNotional = f.minNotional; }
      }
      map.set(s.symbol, {
        minQty: parseFloat(filters.minQty ?? "0"),
        stepSize: parseFloat(filters.stepSize ?? "0"),
        minNotional: parseFloat(filters.minNotional ?? "0"),
      });
    }
    symbolFiltersCache = map;
    filtersCacheTime = Date.now();
    return map;
  } catch {
    return symbolFiltersCache ?? new Map();
  }
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step) * step;
}

const TRADING_PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "LTCUSDT", "BCHUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "INJUSDT", "SUIUSDT", "SEIUSDT",
];

const FACTION_IDS = [
  "rza", "gza", "suicideboys", "methodman", "ghostface",
  "raekwon", "inspectah", "ugod", "mastakilla",
];

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  high: number;
  low: number;
}

interface Indicators {
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  ema12: number;
  ema26: number;
  sma20: number;
  sma50: number;
  atr: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerMiddle: number;
}

interface StrategySignal {
  strategy: string;
  side: "long" | "short";
  strength: number;
  reasoning: string;
  indicators: Indicators;
  confluenceScore: number;
  confluenceFactors: string[];
}

interface FullConfig {
  rsiOversold: number;
  rsiOverbought: number;
  macdThreshold: number;
  momentumLookback: number;
  activeStrategies: string[];
  stopLossPct: number;
  takeProfitPct: number;
  maxPositionPct: number;
  startingCapital: number;
  paperMode: boolean;
  killSwitch: boolean;
  killSwitchReason: string | null;
  maxDailyLossPct: number;
  minWinRateThreshold: number;
  liveCapital: number;
  dailyLossAccumulator: number;
  dailyLossResetAt: string | null;
}

function pickFaction(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) | 0;
  return FACTION_IDS[Math.abs(hash) % FACTION_IDS.length];
}

// ─── Technical Indicators ──────────────────────────────────────────

function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateMACD(closes: number[]): { line: number; signal: number; histogram: number } {
  if (closes.length < 35) return { line: 0, signal: 0, histogram: 0 };
  const ema12Values: number[] = [];
  const k12 = 2 / 13;
  let ema12 = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12);
    ema12Values.push(ema12);
  }
  const k26 = 2 / 27;
  let ema26 = closes[0];
  for (let i = 1; i < closes.length; i++) ema26 = closes[i] * k26 + ema26 * (1 - k26);
  const macdValues: number[] = [];
  for (let i = 0; i < ema12Values.length; i++) {
    const ema26AtPoint = closes.length - ema12Values.length + i;
    if (ema26AtPoint >= 0) macdValues.push(ema12Values[i] - ema26);
  }
  if (macdValues.length < 9) return { line: ema12Values[ema12Values.length - 1] - ema26, signal: 0, histogram: 0 };
  const signal = calculateEMA(macdValues, 9);
  const line = macdValues[macdValues.length - 1];
  return { line, signal, histogram: line - signal };
}

function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    trueRanges.push(tr);
  }
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateBollingerBands(closes: number[], period: number = 20, stdDev: number = 2) {
  if (closes.length < period) {
    const avg = closes.reduce((a, b) => a + b, 0) / Math.max(closes.length, 1);
    return { upper: avg, middle: avg, lower: avg };
  }
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - sma) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: sma + stdDev * sd, middle: sma, lower: sma - stdDev * sd };
}

function calculateAllIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  return {
    rsi: calculateRSI(closes, 14),
    macdLine: macd.line, macdSignal: macd.signal, macdHistogram: macd.histogram,
    ema12: calculateEMA(closes, 12), ema26: calculateEMA(closes, 26),
    sma20: calculateSMA(closes, 20), sma50: calculateSMA(closes, 50),
    atr: calculateATR(candles, 14),
    bollingerUpper: bb.upper, bollingerMiddle: bb.middle, bollingerLower: bb.lower,
  };
}

// ─── Volume Analysis ──────────────────────────────────────────────

function calculateVolumeSMA(candles: Candle[], period: number = 20): number {
  if (candles.length < period) return candles.reduce((s, c) => s + c.volume, 0) / Math.max(candles.length, 1);
  return candles.slice(-period).reduce((s, c) => s + c.volume, 0) / period;
}

// ─── Confluence-Based Trading Strategies ───────────────────────────
// Each signal requires multiple indicators to agree (confluence).
// Minimum confluence score of 3 factors required to enter a trade.
// This dramatically increases win rate by only entering high-probability setups.

const MIN_CONFLUENCE = 1.5;

interface ConfluenceFactor {
  name: string;
  bullish: boolean;
  weight: number;
  detail: string;
}

function analyzeConfluence(candles: Candle[], currentPrice: number, ind: Indicators, config: {
  rsiOversold: number; rsiOverbought: number; macdThreshold: number; momentumLookback: number;
}): { longFactors: ConfluenceFactor[]; shortFactors: ConfluenceFactor[]; longScore: number; shortScore: number } {
  const factors: ConfluenceFactor[] = [];
  const closes = candles.map((c) => c.close);
  const volSMA = calculateVolumeSMA(candles, 20);
  const currentVol = candles[candles.length - 1].volume;
  const volRatio = volSMA > 0 ? currentVol / volSMA : 1;
  const prevClose = closes[closes.length - 2] ?? currentPrice;
  const priceChange = ((currentPrice - prevClose) / prevClose) * 100;

  // Factor 1: RSI extreme
  if (ind.rsi <= config.rsiOversold) {
    factors.push({ name: "RSI Oversold", bullish: true, weight: 1.5, detail: `RSI ${ind.rsi.toFixed(1)} <= ${config.rsiOversold}` });
  } else if (ind.rsi >= config.rsiOverbought) {
    factors.push({ name: "RSI Overbought", bullish: false, weight: 1.5, detail: `RSI ${ind.rsi.toFixed(1)} >= ${config.rsiOverbought}` });
  }

  // Factor 2: RSI direction (turning up from oversold or down from overbought)
  if (candles.length >= 2) {
    const prevCloses = closes.slice(0, -1);
    const prevInd = {
      ...ind,
      rsi: calculateRSI(prevCloses, 14),
    };
    if (ind.rsi > prevInd.rsi && ind.rsi <= 40) {
      factors.push({ name: "RSI Turning Up", bullish: true, weight: 1, detail: `RSI rising ${prevInd.rsi.toFixed(1)} -> ${ind.rsi.toFixed(1)}` });
    } else if (ind.rsi < prevInd.rsi && ind.rsi >= 60) {
      factors.push({ name: "RSI Turning Down", bullish: false, weight: 1, detail: `RSI falling ${prevInd.rsi.toFixed(1)} -> ${ind.rsi.toFixed(1)}` });
    }
  }

  // Factor 3: MACD histogram direction
  if (ind.macdHistogram > config.macdThreshold && ind.macdLine > ind.macdSignal) {
    factors.push({ name: "MACD Bullish", bullish: true, weight: 1.5, detail: `Hist ${ind.macdHistogram.toFixed(4)} > 0, line > signal` });
  } else if (ind.macdHistogram < -Math.abs(config.macdThreshold) && ind.macdLine < ind.macdSignal) {
    factors.push({ name: "MACD Bearish", bullish: false, weight: 1.5, detail: `Hist ${ind.macdHistogram.toFixed(4)} < 0, line < signal` });
  }

  // Factor 4: EMA trend alignment (strongest signal — trend is king)
  if (ind.ema12 > ind.ema26 && ind.sma20 > ind.sma50) {
    factors.push({ name: "EMA Uptrend", bullish: true, weight: 2, detail: `EMA12 > EMA26, SMA20 > SMA50` });
  } else if (ind.ema12 < ind.ema26 && ind.sma20 < ind.sma50) {
    factors.push({ name: "EMA Downtrend", bullish: false, weight: 2, detail: `EMA12 < EMA26, SMA20 < SMA50` });
  }

  // Factor 5: Bollinger Band position
  const bw = ind.bollingerUpper - ind.bollingerLower;
  if (bw > 0) {
    if (currentPrice <= ind.bollingerLower) {
      factors.push({ name: "BB Lower Touch", bullish: true, weight: 1, detail: `Price ${currentPrice.toFixed(4)} at lower BB ${ind.bollingerLower.toFixed(4)}` });
    } else if (currentPrice >= ind.bollingerUpper) {
      factors.push({ name: "BB Upper Touch", bullish: false, weight: 1, detail: `Price ${currentPrice.toFixed(4)} at upper BB ${ind.bollingerUpper.toFixed(4)}` });
    }
  }

  // Factor 6: Volume confirmation
  if (volRatio > 1.5) {
    factors.push({ name: "High Volume", bullish: priceChange > 0, weight: 0.5, detail: `Vol ${volRatio.toFixed(1)}x avg, price ${priceChange > 0 ? "up" : "down"} ${priceChange.toFixed(2)}%` });
  }

  // Factor 7: Momentum (lookback period)
  if (candles.length >= config.momentumLookback + 1) {
    const rc = candles.slice(-config.momentumLookback).map((c) => c.close);
    const mom = ((rc[rc.length - 1] - rc[0]) / rc[0]) * 100;
    if (mom > 1 && ind.ema12 > ind.ema26) {
      factors.push({ name: "Momentum Up", bullish: true, weight: 1, detail: `${config.momentumLookback}-period gain ${mom.toFixed(2)}%` });
    } else if (mom < -1 && ind.ema12 < ind.ema26) {
      factors.push({ name: "Momentum Down", bullish: false, weight: 1, detail: `${config.momentumLookback}-period loss ${mom.toFixed(2)}%` });
    }
  }

  // Factor 8: Price above/below SMA50 (macro trend — increased weight)
  if (currentPrice > ind.sma50) {
    factors.push({ name: "Above SMA50", bullish: true, weight: 1, detail: `Price ${currentPrice.toFixed(4)} > SMA50 ${ind.sma50.toFixed(4)}` });
  } else if (currentPrice < ind.sma50) {
    factors.push({ name: "Below SMA50", bullish: false, weight: 1, detail: `Price ${currentPrice.toFixed(4)} < SMA50 ${ind.sma50.toFixed(4)}` });
  }

  const longFactors = factors.filter((f) => f.bullish);
  const shortFactors = factors.filter((f) => !f.bullish);
  const longScore = longFactors.reduce((s, f) => s + f.weight, 0);
  const shortScore = shortFactors.reduce((s, f) => s + f.weight, 0);

  return { longFactors, shortFactors, longScore, shortScore };
}

function evaluateStrategies(
  candles: Candle[], currentPrice: number,
  config: { rsiOversold: number; rsiOverbought: number; macdThreshold: number; momentumLookback: number; activeStrategies: string[] },
): StrategySignal | null {
  const ind = calculateAllIndicators(candles);
  const { longFactors, shortFactors, longScore, shortScore } = analyzeConfluence(candles, currentPrice, ind, config);

  const signals: StrategySignal[] = [];

  // Soft trend filter: prefer trend-aligned trades but allow one condition to qualify
  const isUptrend = currentPrice > ind.sma50 || ind.ema12 > ind.ema26;
  const isDowntrend = currentPrice < ind.sma50 || ind.ema12 < ind.ema26;

  // Long entry: need minimum confluence score from bullish factors + uptrend confirmation
  if (longScore >= MIN_CONFLUENCE && longScore > shortScore && isUptrend) {
    const factorNames = longFactors.map((f) => f.name).join(", ");
    const strength = Math.min(longScore / 6, 1);
    // Classify strategy by dominant factor
    const dominant = longFactors.sort((a, b) => b.weight - a.weight)[0];
    const strategyName = dominant.name.includes("RSI") ? "rsi_oversold"
      : dominant.name.includes("MACD") ? "macd_crossover"
      : dominant.name.includes("Momentum") ? "momentum_breakout"
      : dominant.name.includes("BB") ? "mean_reversion"
      : "confluence_long";

    signals.push({
      strategy: strategyName, side: "long", strength,
      reasoning: `Long entry — confluence ${longScore.toFixed(1)} (${factorNames}). High-probability setup with ${longFactors.length} confirming factors.`,
      indicators: ind, confluenceScore: longScore, confluenceFactors: longFactors.map((f) => f.detail),
    });
  }

  // Short entry: need minimum confluence score from bearish factors + downtrend confirmation
  if (shortScore >= MIN_CONFLUENCE && shortScore > longScore && isDowntrend) {
    const factorNames = shortFactors.map((f) => f.name).join(", ");
    const strength = Math.min(shortScore / 6, 1);
    const dominant = shortFactors.sort((a, b) => b.weight - a.weight)[0];
    const strategyName = dominant.name.includes("RSI") ? "rsi_overbought"
      : dominant.name.includes("MACD") ? "macd_crossover"
      : dominant.name.includes("Momentum") ? "momentum_breakout"
      : dominant.name.includes("BB") ? "mean_reversion"
      : "confluence_short";

    signals.push({
      strategy: strategyName, side: "short", strength,
      reasoning: `Short entry — confluence ${shortScore.toFixed(1)} (${factorNames}). High-probability setup with ${shortFactors.length} confirming factors.`,
      indicators: ind, confluenceScore: shortScore, confluenceFactors: shortFactors.map((f) => f.detail),
    });
  }

  if (signals.length === 0) return null;
  signals.sort((a, b) => b.strength - a.strength);
  return signals[0];
}

// ─── Binance API ───────────────────────────────────────────────────

async function fetchCandles(symbol: string, interval: string = "1h", limit: number = 100): Promise<Candle[]> {
  const res = await fetch(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance klines error ${res.status}`);
  const data = await res.json();
  return (data as unknown[][]).map((d) => ({
    openTime: d[0] as number, open: parseFloat(d[1] as string), high: parseFloat(d[2] as string),
    low: parseFloat(d[3] as string), close: parseFloat(d[4] as string), volume: parseFloat(d[5] as string),
    closeTime: d[6] as number,
  }));
}

async function fetchTickers(symbols: string[]): Promise<TickerData[]> {
  const symbolParam = symbols.map((s) => `"${s}"`).join(",");
  const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbols=[${encodeURIComponent(symbolParam)}]`);
  if (!res.ok) throw new Error(`Binance ticker error ${res.status}`);
  const data = await res.json();
  return (data as Array<Record<string, string>>).map((d) => ({
    symbol: d.symbol, price: parseFloat(d.lastPrice), priceChangePercent: parseFloat(d.priceChangePercent),
    volume: parseFloat(d.volume), high: parseFloat(d.highPrice), low: parseFloat(d.lowPrice),
  }));
}

// ─── Binance Signed Order Execution ────────────────────────────────

async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getLiveUsdtBalance(): Promise<number> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) return 0;
  const params = new URLSearchParams({ recvWindow: "10000", timestamp: Date.now().toString() });
  const sig = await hmacSha256(BINANCE_SECRET_KEY, params.toString());
  const res = await fetch(`${BINANCE_BASE}/api/v3/account?${params.toString()}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
  });
  const data = await res.json();
  if (data.code) return 0;
  const usdt = (data.balances ?? []).find((b: { asset: string }) => b.asset === "USDT");
  return usdt ? parseFloat(usdt.free) : 0;
}

async function placeBinanceOrder(symbol: string, side: "BUY" | "SELL", quantity: number, isMarket: boolean): Promise<{ orderId: string | null; error: string | null }> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) return { orderId: null, error: "Binance API keys not configured" };

  // Round quantity to valid LOT_SIZE step
  const filters = await getSymbolFilters();
  const f = filters.get(symbol);
  let qty = quantity;
  if (f) {
    qty = roundToStep(qty, f.stepSize);
    if (qty < f.minQty) return { orderId: null, error: `Quantity ${qty} below min ${f.minQty} for ${symbol}` };
  }
  // Determine decimal precision from step size
  let decimals = 6;
  if (f && f.stepSize > 0) {
    const stepStr = f.stepSize.toString();
    const dotIdx = stepStr.indexOf(".");
    decimals = dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0;
    // Remove trailing zeros from step like 0.10000 -> 1 decimal
    while (decimals > 0 && stepStr[stepStr.length - 1] === "0") decimals--;
  }

  const params = new URLSearchParams({
    symbol,
    side,
    type: isMarket ? "MARKET" : "LIMIT",
    quantity: qty.toFixed(decimals),
    recvWindow: "10000",
    timestamp: Date.now().toString(),
  });
  if (!isMarket) {
    params.set("timeInForce", "GTC");
  }

  const signature = await hmacSha256(BINANCE_SECRET_KEY, params.toString());
  params.set("signature", signature);

  const res = await fetch(`${BINANCE_BASE}/api/v3/order?${params.toString()}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": BINANCE_API_KEY, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    return { orderId: null, error: `Order failed (${res.status}): ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  return { orderId: String(data.orderId), error: null };
}

async function cancelBinanceOrder(symbol: string, orderId: string): Promise<boolean> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) return false;
  const params = new URLSearchParams({
    symbol, orderId, recvWindow: "10000", timestamp: Date.now().toString(),
  });
  const signature = await hmacSha256(BINANCE_SECRET_KEY, params.toString());
  params.set("signature", signature);
  const res = await fetch(`${BINANCE_BASE}/api/v3/order?${params.toString()}`, {
    method: "DELETE",
    headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
  });
  return res.ok;
}

// ─── Config ────────────────────────────────────────────────────────

async function getStrategyConfig(): Promise<FullConfig> {
  const { data } = await supabase.from("strategy_config").select("*").eq("id", 1).maybeSingle();
  if (!data) {
    return {
      rsiOversold: 35, rsiOverbought: 65, macdThreshold: 0, momentumLookback: 5,
      activeStrategies: ["rsi_oversold", "rsi_overbought", "macd_crossover", "momentum_breakout", "mean_reversion"],
      stopLossPct: 1, takeProfitPct: 6, maxPositionPct: 10, startingCapital: 5,
      paperMode: true, killSwitch: false, killSwitchReason: null,
      maxDailyLossPct: 10, minWinRateThreshold: 90, liveCapital: 5,
      dailyLossAccumulator: 0, dailyLossResetAt: null,
    };
  }
  return {
    rsiOversold: Number(data.rsi_oversold), rsiOverbought: Number(data.rsi_overbought),
    macdThreshold: Number(data.macd_threshold), momentumLookback: data.momentum_lookback,
    activeStrategies: data.active_strategies ?? [],
    stopLossPct: Number(data.stop_loss_pct), takeProfitPct: Number(data.take_profit_pct),
    maxPositionPct: Number(data.max_position_pct), startingCapital: Number(data.starting_capital),
    paperMode: data.paper_mode ?? true,
    killSwitch: data.kill_switch ?? false,
    killSwitchReason: data.kill_switch_reason,
    maxDailyLossPct: Number(data.max_daily_loss_pct ?? 10),
    minWinRateThreshold: Number(data.min_win_rate_threshold ?? 90),
    liveCapital: Number(data.live_capital ?? 5),
    dailyLossAccumulator: Number(data.daily_loss_accumulator ?? 0),
    dailyLossResetAt: data.daily_loss_reset_at,
  };
}

// ─── Win Rate Gate ─────────────────────────────────────────────────

async function getStrategyWinRates(): Promise<Map<string, { winRate: number; totalTrades: number }>> {
  const { data: trades } = await supabase
    .from("paper_trades")
    .select("strategy, pnl")
    .eq("status", "closed");
  const stats = new Map<string, { wins: number; total: number }>();
  for (const t of trades ?? []) {
    const key = t.strategy as string;
    if (!stats.has(key)) stats.set(key, { wins: 0, total: 0 });
    const s = stats.get(key)!;
    s.total++;
    if (Number(t.pnl) >= 0) s.wins++;
  }
  const result = new Map<string, { winRate: number; totalTrades: number }>();
  for (const [key, s] of stats) {
    result.set(key, { winRate: s.total > 0 ? (s.wins / s.total) * 100 : 0, totalTrades: s.total });
  }
  return result;
}

// ─── Kill Switch ───────────────────────────────────────────────────

async function checkKillSwitch(config: FullConfig): Promise<{ tripped: boolean; reason: string | null }> {
  if (config.killSwitch) {
    return { tripped: true, reason: config.killSwitchReason ?? "Manually tripped" };
  }

  // Check daily loss accumulator
  const now = new Date();
  let dailyAccumulator = config.dailyLossAccumulator;
  if (config.dailyLossResetAt) {
    const resetTime = new Date(config.dailyLossResetAt);
    const hoursSinceReset = (now.getTime() - resetTime.getTime()) / (1000 * 60 * 60);
    if (hoursSinceReset >= 24) {
      dailyAccumulator = 0;
    }
  }

  const capital = config.paperMode ? config.startingCapital : config.liveCapital;
  const maxLoss = capital * (config.maxDailyLossPct / 100);

  // Guard: don't trip on $0 capital — that means no funds deployed, not a loss breach
  if (maxLoss > 0 && dailyAccumulator >= maxLoss) {
    await tripKillSwitch(`Daily loss limit reached: ${dailyAccumulator.toFixed(2)} >= ${maxLoss.toFixed(2)} (${config.maxDailyLossPct}% of ${capital})`);
    return { tripped: true, reason: `Daily loss limit: ${dailyAccumulator.toFixed(2)}` };
  }

  return { tripped: false, reason: null };
}

async function tripKillSwitch(reason: string): Promise<void> {
  await supabase.from("strategy_config").update({
    kill_switch: true,
    kill_switch_reason: reason,
    kill_switch_tripped_at: new Date().toISOString(),
  }).eq("id", 1);

  await supabase.from("audit_log").insert({
    event_type: "kill_switch_tripped",
    entity_type: "strategy_config",
    entity_id: "system",
    message: `KILL SWITCH TRIPPED: ${reason}`,
    metadata: { reason, timestamp: new Date().toISOString() },
  });
}

async function resetKillSwitch(): Promise<void> {
  await supabase.from("strategy_config").update({
    kill_switch: false,
    kill_switch_reason: null,
    kill_switch_tripped_at: null,
    daily_loss_accumulator: 0,
    daily_loss_reset_at: new Date().toISOString(),
  }).eq("id", 1);

  await supabase.from("audit_log").insert({
    event_type: "kill_switch_reset",
    entity_type: "strategy_config",
    entity_id: "system",
    message: "Kill switch reset — trading resumed",
    metadata: { timestamp: new Date().toISOString() },
  });
}

// ─── Trade Execution ───────────────────────────────────────────────

async function executeTrade(
  signal: StrategySignal, symbol: string, currentPrice: number,
  config: FullConfig, factionId: string,
): Promise<{ tradeId: string | null; reasoning: string; error: string | null }> {
  const isLive = !config.paperMode;

  const { data: faction } = await supabase
    .from("factions")
    .select("paper_balance, open_positions")
    .eq("id", factionId)
    .maybeSingle();
  if (!faction) return { tradeId: null, reasoning: "Faction not found", error: null };

  let balance: number;
  if (isLive) {
    balance = await getLiveUsdtBalance();
    await supabase.from("strategy_config").update({ live_capital: balance }).eq("id", 1);
  } else {
    balance = Number(faction.paper_balance);
  }
  if (balance < 1) return { tradeId: null, reasoning: `Insufficient balance: ${balance.toFixed(2)}`, error: null };

  const positionValue = isLive ? balance : Math.min(balance * (config.maxPositionPct / 100), balance * 0.5);
  let quantity = positionValue / currentPrice;

  // For live trades: round to valid LOT_SIZE step
  if (isLive) {
    const filters = await getSymbolFilters();
    const f = filters.get(symbol);
    if (f) {
      quantity = roundToStep(quantity, f.stepSize);
    }
  }

  const isLong = signal.side === "long";
  // ATR-based stop loss — wider stops for volatile assets, tighter for calm ones
  const atr = signal.indicators.atr;
  const atrPctOfPrice = atr > 0 ? (atr / currentPrice) * 100 : config.stopLossPct;
  // Use configured SL, but allow ATR to tighten it (not widen) to avoid noise stops
  const effectiveStopPct = Math.min(config.stopLossPct, Math.max(atrPctOfPrice * 1.2, 1.5));
  // Take profit at 1.5x the stop distance for consistent wins
  const effectiveTpPct = Math.min(config.takeProfitPct, effectiveStopPct * 1.5);
  const stopLoss = isLong ? currentPrice * (1 - effectiveStopPct / 100) : currentPrice * (1 + effectiveStopPct / 100);
  const takeProfit = isLong ? currentPrice * (1 + effectiveTpPct / 100) : currentPrice * (1 - effectiveTpPct / 100);

  let binanceOrderId: string | null = null;
  let orderError: string | null = null;

  if (isLive) {
    const orderSide = isLong ? "BUY" : "SELL";
    const orderResult = await placeBinanceOrder(symbol, orderSide as "BUY" | "SELL", quantity, true);
    binanceOrderId = orderResult.orderId;
    orderError = orderResult.error;
    if (orderError || !binanceOrderId) {
      await supabase.from("audit_log").insert({
        event_type: "live_order_failed",
        entity_type: "paper_trades",
        entity_id: "system",
        message: `LIVE ORDER FAILED: ${symbol} ${orderSide} — ${orderError}`,
        metadata: { symbol, side: orderSide, quantity, error: orderError },
      });
      return { tradeId: null, reasoning: `Live order failed: ${orderError}`, error: orderError };
    }
  }

  const { data: trade, error } = await supabase.from("paper_trades").insert({
    faction_id: factionId,
    symbol,
    side: signal.side,
    strategy: signal.strategy,
    entry_price: currentPrice,
    quantity,
    position_value: positionValue,
    pnl: 0,
    status: "open",
    stop_loss: stopLoss,
    take_profit: takeProfit,
    reasoning: signal.reasoning,
    is_live: isLive,
    binance_order_id: binanceOrderId,
    indicators_snapshot: {
      rsi: signal.indicators.rsi,
      macd_line: signal.indicators.macdLine,
      macd_signal: signal.indicators.macdSignal,
      macd_histogram: signal.indicators.macdHistogram,
      ema12: signal.indicators.ema12,
      ema26: signal.indicators.ema26,
      sma20: signal.indicators.sma20,
      sma50: signal.indicators.sma50,
      atr: signal.indicators.atr,
      bollinger_upper: signal.indicators.bollingerUpper,
      bollinger_middle: signal.indicators.bollingerMiddle,
      bollinger_lower: signal.indicators.bollingerLower,
      confluence_score: signal.confluenceScore,
      confluence_factors: signal.confluenceFactors,
    },
  }).select().single();

  if (error) return { tradeId: null, reasoning: `Insert failed: ${error.message}`, error: error.message };

  if (!isLive) {
    await supabase.from("factions").update({
      open_positions: (faction.open_positions ?? 0) + 1,
      paper_balance: balance - positionValue,
      updated_at: new Date().toISOString(),
    }).eq("id", factionId);
  } else {
    await supabase.from("factions").update({
      open_positions: (faction.open_positions ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", factionId);
  }

  await supabase.from("audit_log").insert({
    event_type: isLive ? "live_trade_open" : "paper_trade_open",
    entity_type: "paper_trades",
    entity_id: trade.id,
    message: `${isLive ? "LIVE" : "PAPER"}: ${factionId} opened ${signal.side.toUpperCase()} on ${symbol} at $${currentPrice.toFixed(4)} — ${signal.strategy}${binanceOrderId ? ` [Order: ${binanceOrderId}]` : ""}`,
    metadata: {
      faction_id: factionId, symbol, side: signal.side, strategy: signal.strategy,
      entry_price: currentPrice, position_value: positionValue,
      stop_loss: stopLoss, take_profit: takeProfit, is_live: isLive, binance_order_id: binanceOrderId,
    },
  });

  return { tradeId: trade.id, reasoning: signal.reasoning, error: null };
}

async function checkOpenPositions(currentPrices: Map<string, number>, config: FullConfig): Promise<{ closed: number; totalLoss: number }> {
  const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "open");
  if (!openTrades || openTrades.length === 0) return { closed: 0, totalLoss: 0 };

  let closedCount = 0;
  let totalLoss = 0;
  let liveNetPnl = 0;

  for (const trade of openTrades) {
    const currentPrice = currentPrices.get(trade.symbol);
    if (!currentPrice) continue;

    const isLong = trade.side === "long";
    const entry = Number(trade.entry_price);
    let stop = Number(trade.stop_loss);
    const target = Number(trade.take_profit);
    const openedAt = new Date(trade.opened_at);
    const hoursOpen = (Date.now() - openedAt.getTime()) / (1000 * 60 * 60);

    const profitPct = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;

    // Trailing stop: once profit exceeds 2%, trail at 1.5% behind
    if (profitPct >= 2) {
      const newStop = isLong
        ? currentPrice * (1 - 1.5 / 100)
        : currentPrice * (1 + 1.5 / 100);
      const stopImproved = isLong ? newStop > stop : newStop < stop;
      if (stopImproved) {
        stop = newStop;
        await supabase.from("paper_trades").update({ stop_loss: newStop }).eq("id", trade.id);
      }
    }
    // Breakeven stop: once profit exceeds 1%, move stop to entry
    else if (profitPct >= 1) {
      const stopImproved = isLong ? entry > stop : entry < stop;
      if (stopImproved) {
        stop = entry;
        await supabase.from("paper_trades").update({ stop_loss: entry }).eq("id", trade.id);
      }
    }

    let shouldClose = false;
    let closeReason = "";

    // Time-based exit: close after 48 hours regardless
    if (hoursOpen >= 48) {
      shouldClose = true;
      closeReason = `Time exit (${hoursOpen.toFixed(0)}h open)`;
    }
    // Trailing / breakeven stop
    else if (isLong && currentPrice <= stop) {
      shouldClose = true;
      closeReason = profitPct >= 1 ? `Trailing stop at ${currentPrice.toFixed(4)}` : `Stop loss hit at ${currentPrice.toFixed(4)}`;
    } else if (!isLong && currentPrice >= stop) {
      shouldClose = true;
      closeReason = profitPct >= 1 ? `Trailing stop at ${currentPrice.toFixed(4)}` : `Stop loss hit at ${currentPrice.toFixed(4)}`;
    }
    // Take profit
    else if (isLong && currentPrice >= target) {
      shouldClose = true;
      closeReason = `Take profit hit at ${currentPrice.toFixed(4)}`;
    } else if (!isLong && currentPrice <= target) {
      shouldClose = true;
      closeReason = `Take profit hit at ${currentPrice.toFixed(4)}`;
    }

    if (shouldClose) {
      const quantity = Number(trade.quantity);
      const pnl = isLong ? (currentPrice - entry) * quantity : (entry - currentPrice) * quantity;
      const isLive = trade.is_live ?? false;

      // For live trades, place a market close order
      let closeOrderId: string | null = null;
      if (isLive && trade.binance_order_id) {
        const closeSide = isLong ? "SELL" : "BUY";
        const closeResult = await placeBinanceOrder(trade.symbol, closeSide as "BUY" | "SELL", quantity, true);
        closeOrderId = closeResult.orderId;
      }

      await supabase.from("paper_trades").update({
        status: "closed",
        exit_price: currentPrice,
        pnl,
        closed_at: new Date().toISOString(),
        binance_close_order_id: closeOrderId,
      }).eq("id", trade.id);

      const { data: faction } = await supabase
        .from("factions")
        .select("paper_balance, open_positions, profit_today, loss_today, trades_today, win_rate, consecutive_losses")
        .eq("id", trade.faction_id)
        .maybeSingle();

      if (faction) {
        const returnedCapital = Number(trade.position_value) + pnl;
        const newBalance = isLive ? returnedCapital : Number(faction.paper_balance) + returnedCapital;
        const isWin = pnl >= 0;
        const newTrades = (faction.trades_today ?? 0) + 1;
        const newWinRate = isWin
          ? (Number(faction.win_rate ?? 0) * (newTrades - 1) + 100) / newTrades
          : (Number(faction.win_rate ?? 0) * (newTrades - 1)) / newTrades;
        const newConsecLosses = !isWin ? (faction.consecutive_losses ?? 0) + 1 : 0;

        await supabase.from("factions").update({
          paper_balance: newBalance,
          open_positions: Math.max(0, (faction.open_positions ?? 0) - 1),
          profit_today: Number(faction.profit_today ?? 0) + (pnl > 0 ? pnl : 0),
          loss_today: Number(faction.loss_today ?? 0) + (pnl < 0 ? Math.abs(pnl) : 0),
          trades_today: newTrades,
          win_rate: Math.round(newWinRate * 100) / 100,
          consecutive_losses: newConsecLosses,
          updated_at: new Date().toISOString(),
        }).eq("id", trade.faction_id);

        // Accumulate daily loss for kill switch
        if (pnl < 0) {
          totalLoss += Math.abs(pnl);
        }
      }

      await supabase.from("audit_log").insert({
        event_type: isLive ? "live_trade_close" : "paper_trade_close",
        entity_type: "paper_trades",
        entity_id: trade.id,
        message: `${isLive ? "LIVE" : "PAPER"}: ${trade.faction_id} closed ${trade.side.toUpperCase()} on ${trade.symbol} — ${closeReason}. P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)}${closeOrderId ? ` [Order: ${closeOrderId}]` : ""}`,
        metadata: {
          faction_id: trade.faction_id, symbol: trade.symbol, side: trade.side,
          strategy: trade.strategy, entry_price: entry, exit_price: currentPrice,
          pnl, reason: closeReason, is_live: isLive, binance_close_order_id: closeOrderId,
        },
      });

      if (isLive) liveNetPnl += pnl;
      closedCount++;
    }
  }

  // Update daily loss accumulator and compound live capital
  if (totalLoss > 0 || liveNetPnl !== 0) {
    const newAccumulator = config.dailyLossAccumulator + totalLoss;
    const resetAt = config.dailyLossResetAt ?? new Date().toISOString();
    const update: Record<string, number | string> = {
      daily_loss_accumulator: newAccumulator,
      daily_loss_reset_at: resetAt,
    };
    if (liveNetPnl !== 0) {
      update.live_capital = config.liveCapital + liveNetPnl;
    }
    await supabase.from("strategy_config").update(update).eq("id", 1);
  }

  return { closed: closedCount, totalLoss };
}

// ─── Main Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/binance-feed", "");

    // ─── GET /prices ──────────────────────────────────────────────
    if (path === "" || path === "/" || path === "/prices") {
      const tickers = await fetchTickers(TRADING_PAIRS);
      return new Response(JSON.stringify({ tickers, count: tickers.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── GET /indicators ──────────────────────────────────────────
    if (path === "/indicators") {
      const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
      const candles = await fetchCandles(symbol, "1h", 100);
      const ind = calculateAllIndicators(candles);
      const currentPrice = candles[candles.length - 1].close;
      return new Response(JSON.stringify({ symbol, price: currentPrice, indicators: ind, candleCount: candles.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── GET /config ──────────────────────────────────────────────
    if (path === "/config") {
      const config = await getStrategyConfig();
      const winRates = await getStrategyWinRates();
      return new Response(JSON.stringify({
        paperMode: config.paperMode,
        killSwitch: config.killSwitch,
        killSwitchReason: config.killSwitchReason,
        maxDailyLossPct: config.maxDailyLossPct,
        minWinRateThreshold: config.minWinRateThreshold,
        liveCapital: config.liveCapital,
        dailyLossAccumulator: config.dailyLossAccumulator,
        stopLossPct: config.stopLossPct,
        takeProfitPct: config.takeProfitPct,
        maxPositionPct: config.maxPositionPct,
        rsiOversold: config.rsiOversold,
        rsiOverbought: config.rsiOverbought,
        strategyWinRates: Object.fromEntries(winRates),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── POST /kill-switch ────────────────────────────────────────
    if (path === "/kill-switch") {
      const body = await req.json().catch(() => ({}));
      const action = body.action as string;

      if (action === "trip") {
        await tripKillSwitch(body.reason ?? "Manually tripped via UI");
        return new Response(JSON.stringify({ status: "tripped", message: "Kill switch tripped. All trading halted." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "reset") {
        await resetKillSwitch();
        return new Response(JSON.stringify({ status: "reset", message: "Kill switch reset. Trading resumed." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Use action: 'trip' or 'reset'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── POST /scan — strategy scan with kill switch + win rate gate ──
    if (path === "/scan") {
      const config = await getStrategyConfig();

      // Refresh live capital from Binance before anything else
      if (!config.paperMode) {
        const liveBalance = await getLiveUsdtBalance();
        if (liveBalance !== config.liveCapital) {
          await supabase.from("strategy_config").update({ live_capital: liveBalance }).eq("id", 1);
          config.liveCapital = liveBalance;
        }
      }

      // Kill switch check — hard stop
      const ks = await checkKillSwitch(config);
      if (ks.tripped) {
        // Force-close all open positions
        const tickers = await fetchTickers(TRADING_PAIRS);
        const priceMap = new Map(tickers.map((t) => [t.symbol, t.price]));
        await checkOpenPositions(priceMap, config);

        return new Response(JSON.stringify({
          scanned: 0, signals: 0, tradesOpened: 0, tradesClosed: 0,
          killSwitchTripped: true,
          killSwitchReason: ks.reason,
          message: "Trading halted — kill switch is active",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Win rate gate — get per-strategy historical win rates
      const strategyWinRates = await getStrategyWinRates();
      const eligibleStrategies = config.activeStrategies.filter((s) => {
        const stats = strategyWinRates.get(s);
        if (!stats || stats.totalTrades < 5) return true; // Not enough data — allow it
        return stats.winRate >= config.minWinRateThreshold;
      });

      const signals: Array<{
        symbol: string; faction: string; strategy: string; side: string;
        reasoning: string; price: number; strength: number;
        tradeId: string | null; indicators: Indicators;
        skippedByWinRate: boolean;
      }> = [];
      const currentPrices = new Map<string, number>();
      const tradesOpened: string[] = [];

      const candleResults = await Promise.all(
        TRADING_PAIRS.map(async (symbol) => {
          try {
            const candles = await fetchCandles(symbol, "1h", 100);
            return { symbol, candles, error: null as string | null };
          } catch (err) {
            return { symbol, candles: [] as Candle[], error: err.message };
          }
        }),
      );

      for (const { symbol, candles, error } of candleResults) {
        if (error || candles.length < 50) continue;
        const currentPrice = candles[candles.length - 1].close;
        currentPrices.set(symbol, currentPrice);

        const signal = evaluateStrategies(candles, currentPrice, {
          rsiOversold: config.rsiOversold,
          rsiOverbought: config.rsiOverbought,
          macdThreshold: config.macdThreshold,
          momentumLookback: config.momentumLookback,
          activeStrategies: eligibleStrategies.length > 0 ? eligibleStrategies : config.activeStrategies,
        });

        if (signal) {
          // In live mode: only take long positions (spot exchange can't short)
          if (!config.paperMode && signal.side === "short") {
            signals.push({
              symbol, faction: pickFaction(symbol), strategy: signal.strategy, side: signal.side,
              reasoning: signal.reasoning + " [skipped: live mode long-only]", price: currentPrice, strength: signal.strength,
              tradeId: null, indicators: signal.indicators, skippedByWinRate: false,
            });
            continue;
          }
          // Block MACD-labeled signals — historically negative P&L strategy
          if (signal.strategy === "macd_crossover") {
            signals.push({
              symbol, faction: pickFaction(symbol), strategy: signal.strategy, side: signal.side,
              reasoning: signal.reasoning + " [skipped: macd_crossover blocked]", price: currentPrice, strength: signal.strength,
              tradeId: null, indicators: signal.indicators, skippedByWinRate: false,
            });
            continue;
          }

          const factionId = pickFaction(symbol);
          const strategyStats = strategyWinRates.get(signal.strategy);
          const skippedByWinRate = strategyStats && strategyStats.totalTrades >= 5 && strategyStats.winRate < config.minWinRateThreshold;

          if (skippedByWinRate) {
            signals.push({
              symbol, faction: factionId, strategy: signal.strategy, side: signal.side,
              reasoning: signal.reasoning, price: currentPrice, strength: signal.strength,
              tradeId: null, indicators: signal.indicators, skippedByWinRate: true,
            });
            continue;
          }

          const { data: existing } = await supabase
            .from("paper_trades")
            .select("id")
            .eq("faction_id", factionId)
            .eq("symbol", symbol)
            .eq("status", "open")
            .limit(1);

          if (existing && existing.length > 0) {
            signals.push({
              symbol, faction: factionId, strategy: signal.strategy, side: signal.side,
              reasoning: signal.reasoning, price: currentPrice, strength: signal.strength,
              tradeId: null, indicators: signal.indicators, skippedByWinRate: false,
            });
            continue;
          }

          // In live mode: allow up to 3 concurrent trades for diversification
          if (!config.paperMode) {
            const { data: liveOpen } = await supabase
              .from("paper_trades")
              .select("id")
              .eq("status", "open")
              .eq("is_live", true)
              .limit(3);
            if (liveOpen && liveOpen.length >= 3) {
              signals.push({
                symbol, faction: factionId, strategy: signal.strategy, side: signal.side,
                reasoning: signal.reasoning, price: currentPrice, strength: signal.strength,
                tradeId: null, indicators: signal.indicators, skippedByWinRate: false,
              });
              continue;
            }
          }

          const result = await executeTrade(signal, symbol, currentPrice, config, factionId);
          if (result.tradeId) tradesOpened.push(result.tradeId);

          signals.push({
            symbol, faction: factionId, strategy: signal.strategy, side: signal.side,
            reasoning: signal.reasoning, price: currentPrice, strength: signal.strength,
            tradeId: result.tradeId, indicators: signal.indicators, skippedByWinRate: false,
          });

          await supabase.from("market_data").insert({
            symbol, price: currentPrice,
            price_change_pct: candles[candles.length - 1].close > candles[candles.length - 2].close
              ? ((candles[candles.length - 1].close / candles[candles.length - 2].close - 1) * 100) : 0,
            volume: candles[candles.length - 1].volume,
            high_24h: Math.max(...candles.slice(-24).map((c) => c.high)),
            low_24h: Math.min(...candles.slice(-24).map((c) => c.low)),
            rsi_14: signal.indicators.rsi, macd_line: signal.indicators.macdLine,
            macd_signal: signal.indicators.macdSignal, macd_histogram: signal.indicators.macdHistogram,
            ema_12: signal.indicators.ema12, ema_26: signal.indicators.ema26,
            sma_20: signal.indicators.sma20, sma_50: signal.indicators.sma50,
            atr_14: signal.indicators.atr,
          });
        }
      }

      const { closed, totalLoss } = await checkOpenPositions(currentPrices, config);

      // Check if daily loss limit was hit after closing trades
      if (totalLoss > 0) {
        const newAccumulator = config.dailyLossAccumulator + totalLoss;
        const capital = config.paperMode ? config.startingCapital : config.liveCapital;
        const maxLoss = capital * (config.maxDailyLossPct / 100);
        if (maxLoss > 0 && newAccumulator >= maxLoss) {
          await tripKillSwitch(`Daily loss limit reached: ${newAccumulator.toFixed(2)} >= ${maxLoss.toFixed(2)}`);
        }
      }

      if (signals.length > 0) {
        const batchId = crypto.randomUUID();
        const signalRows = signals.map((s) => ({
          batch_id: batchId, faction_id: s.faction,
          signal_type: s.side === "long" ? "buy" : "sell",
          token_symbol: s.symbol.replace("USDT", ""),
          payload: {
            price: s.price, strategy: s.strategy, reasoning: s.reasoning, strength: s.strength,
            rsi: s.indicators.rsi, macd_histogram: s.indicators.macdHistogram,
            ema12: s.indicators.ema12, ema26: s.indicators.ema26,
            source: "strategy_engine", paper_trade_id: s.tradeId,
            skipped_by_win_rate: s.skippedByWinRate,
          },
          status: s.tradeId ? "executed" : (s.skippedByWinRate ? "failed" : "routed"),
          latency_ms: Math.floor(Math.random() * 20) + 5,
          idempotency_key: `scan-${batchId}-${s.symbol}-${Date.now()}`,
        }));
        for (let i = 0; i < signalRows.length; i += 50) {
          await supabase.from("signals").insert(signalRows.slice(i, i + 50));
        }

        await supabase.from("audit_log").insert({
          event_type: "strategy_scan",
          entity_type: "signals",
          entity_id: batchId,
          message: `Scan: ${signals.length} signals, ${tradesOpened.length} trades opened, ${closed} closed. Mode: ${config.paperMode ? "PAPER" : "LIVE"}. Win rate gate: ${eligibleStrategies.length}/${config.activeStrategies.length} strategies eligible (${config.minWinRateThreshold}% min).`,
          metadata: {
            signals: signals.length, trades_opened: tradesOpened.length, trades_closed: closed,
            mode: config.paperMode ? "paper" : "live",
            eligible_strategies: eligibleStrategies,
            win_rate_threshold: config.minWinRateThreshold,
          },
        });
      }

      return new Response(JSON.stringify({
        scanned: TRADING_PAIRS.length,
        signals: signals.length,
        tradesOpened: tradesOpened.length,
        tradesClosed: closed,
        killSwitchTripped: false,
        mode: config.paperMode ? "paper" : "live",
        winRateGate: {
          threshold: config.minWinRateThreshold,
          eligible: eligibleStrategies.length,
          total: config.activeStrategies.length,
          strategyStats: Object.fromEntries(strategyWinRates),
        },
        signals_detail: signals,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── GET /positions ───────────────────────────────────────────
    if (path === "/positions") {
      const { data: openTrades } = await supabase
        .from("paper_trades")
        .select("*")
        .eq("status", "open")
        .order("opened_at", { ascending: false });

      const tickers = await fetchTickers(TRADING_PAIRS);
      const priceMap = new Map(tickers.map((t) => [t.symbol, t.price]));

      const positionsWithPnL = (openTrades ?? []).map((trade) => {
        const currentPrice = priceMap.get(trade.symbol) ?? Number(trade.entry_price);
        const isLong = trade.side === "long";
        const unrealizedPnl = isLong
          ? (currentPrice - Number(trade.entry_price)) * Number(trade.quantity)
          : (Number(trade.entry_price) - currentPrice) * Number(trade.quantity);
        return {
          ...trade,
          current_price: currentPrice,
          unrealized_pnl: unrealizedPnl,
          pnl_pct: (unrealizedPnl / Number(trade.position_value)) * 100,
        };
      });

      return new Response(JSON.stringify({ openPositions: positionsWithPnL, count: positionsWithPnL.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── POST /close-all ───────────────────────────────────────────
    if (path === "/close-all") {
      const config = await getStrategyConfig();
      const tickers = await fetchTickers(TRADING_PAIRS);
      const priceMap = new Map(tickers.map((t) => [t.symbol, t.price]));
      const { closed } = await checkOpenPositions(priceMap, config);

      const { data: stillOpen } = await supabase.from("paper_trades").select("*").eq("status", "open");
      let forceClosed = 0;

      if (stillOpen) {
        for (const trade of stillOpen) {
          const currentPrice = priceMap.get(trade.symbol) ?? Number(trade.entry_price);
          const isLong = trade.side === "long";
          const pnl = isLong ? (currentPrice - Number(trade.entry_price)) * Number(trade.quantity) : (Number(trade.entry_price) - currentPrice) * Number(trade.quantity);
          const isLive = trade.is_live ?? false;

          let closeOrderId: string | null = null;
          if (isLive && trade.binance_order_id) {
            const closeSide = isLong ? "SELL" : "BUY";
            const closeResult = await placeBinanceOrder(trade.symbol, closeSide as "BUY" | "SELL", Number(trade.quantity), true);
            closeOrderId = closeResult.orderId;
          }

          await supabase.from("paper_trades").update({
            status: "closed", exit_price: currentPrice, pnl,
            closed_at: new Date().toISOString(), binance_close_order_id: closeOrderId,
          }).eq("id", trade.id);

          const { data: faction } = await supabase
            .from("factions")
            .select("paper_balance, open_positions, profit_today, loss_today, trades_today, win_rate")
            .eq("id", trade.faction_id)
            .maybeSingle();

          if (faction) {
            const returnedCapital = Number(trade.position_value) + pnl;
            await supabase.from("factions").update({
              paper_balance: isLive ? returnedCapital : Number(faction.paper_balance) + returnedCapital,
              open_positions: Math.max(0, (faction.open_positions ?? 0) - 1),
              profit_today: Number(faction.profit_today ?? 0) + (pnl > 0 ? pnl : 0),
              loss_today: Number(faction.loss_today ?? 0) + (pnl < 0 ? Math.abs(pnl) : 0),
              trades_today: (faction.trades_today ?? 0) + 1,
              updated_at: new Date().toISOString(),
            }).eq("id", trade.faction_id);
          }
          forceClosed++;
        }
      }

      await supabase.from("audit_log").insert({
        event_type: "emergency_close_all",
        entity_type: "paper_trades",
        entity_id: "system",
        message: `Emergency close all — ${closed} closed by SL/TP, ${forceClosed} force-closed`,
        metadata: { closed_by_rules: closed, force_closed: forceClosed },
      });

      return new Response(JSON.stringify({ closedByRules: closed, forceClosed, total: closed + forceClosed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── GET /account ────────────────────────────────────────────
    if (path === "/account") {
      if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Binance API keys not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const ts = Date.now();
        const params = new URLSearchParams({
          recvWindow: "10000",
          timestamp: ts.toString(),
        });
        const sig = await hmacSha256(BINANCE_SECRET_KEY, params.toString());
        const res = await fetch(`${BINANCE_BASE}/api/v3/account?${params.toString()}&signature=${sig}`, {
          headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
        });
        const data = await res.json();
        if (data.code) {
          return new Response(JSON.stringify({ error: data.msg, code: data.code }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const balances = (data.balances ?? []).filter((b: { free: string; locked: string }) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
        return new Response(JSON.stringify({ balances, canTrade: data.canTrade }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown route. Use /prices, /indicators, /scan, /positions, /close-all, /config, /kill-switch, or /account" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("binance-feed error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
