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

// ─── Types ─────────────────────────────────────────────────────────

interface Candle { open: number; high: number; low: number; close: number; volume: number; }
interface Indicators {
  rsi: number; macdLine: number; macdSignal: number; macdHistogram: number;
  ema12: number; ema26: number; sma20: number; sma50: number; atr: number;
  bollingerUpper: number; bollingerMiddle: number; bollingerLower: number;
}
interface Trade {
  side: "long" | "short"; strategy: string; symbol: string;
  entryPrice: number; entryPeriod: number; quantity: number;
  stopLoss: number; takeProfit: number;
}
interface ClosedTrade {
  strategy: string; side: "long" | "short"; entryPrice: number; exitPrice: number;
  pnl: number; pnlPct: number; holdPeriods: number; exitReason: string; period: number;
}
interface BacktestParams {
  rsiOversold: number; rsiOverbought: number; macdThreshold: number;
  momentumLookback: number; stopLossPct: number; takeProfitPct: number;
  maxPositionPct: number; activeStrategies: string[];
}
interface BacktestResult {
  finalEquity: number; totalReturnPct: number; annualizedReturnPct: number;
  maxDrawdownPct: number; sharpeRatio: number; sortinoRatio: number;
  totalTrades: number; winningTrades: number; losingTrades: number;
  winRate: number; avgWin: number; avgLoss: number; profitFactor: number;
  bestTradePct: number; worstTradePct: number; avgHoldPeriods: number;
  equityCurve: { period: number; equity: number }[];
  strategyBreakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
  trades: ClosedTrade[];
}

// ─── Technical Indicators ──────────────────────────────────────────

function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses / period * period);
}

function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calcSMA(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMAArray(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k));
  return result;
}

function calcMACD(closes: number[]): { line: number; signal: number; histogram: number } {
  if (closes.length < 35) return { line: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMAArray(closes, 12);
  const ema26 = calcEMAArray(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalArr = calcEMAArray(macdLine, 9);
  const line = macdLine[macdLine.length - 1];
  const signal = signalArr[signalArr.length - 1];
  return { line, signal, histogram: line - signal };
}

function calcATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
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

function calcBollinger(closes: number[], period: number, stdDev: number) {
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

function calcAllIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes, 20, 2);
  return {
    rsi: calcRSI(closes, 14), macdLine: macd.line, macdSignal: macd.signal,
    macdHistogram: macd.histogram, ema12: calcEMA(closes, 12), ema26: calcEMA(closes, 26),
    sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50), atr: calcATR(candles, 14),
    bollingerUpper: bb.upper, bollingerMiddle: bb.middle, bollingerLower: bb.lower,
  };
}

// ─── Strategy Evaluation ───────────────────────────────────────────

function evaluateStrategies(candles: Candle[], currentPrice: number, params: BacktestParams): {
  side: "long" | "short"; strategy: string;
} | null {
  const ind = calcAllIndicators(candles);
  const signals: { side: "long" | "short"; strategy: string; strength: number }[] = [];

  if (ind.rsi <= params.rsiOversold)
    signals.push({ side: "long", strategy: "rsi_oversold", strength: (params.rsiOversold - ind.rsi) / params.rsiOversold });
  if (ind.rsi >= params.rsiOverbought)
    signals.push({ side: "short", strategy: "rsi_overbought", strength: (ind.rsi - params.rsiOverbought) / (100 - params.rsiOverbought) });
  if (ind.macdHistogram > params.macdThreshold && ind.macdLine > ind.macdSignal)
    signals.push({ side: "long", strategy: "macd_crossover", strength: Math.min(Math.abs(ind.macdHistogram) / Math.max(Math.abs(ind.macdLine), 0.001), 1) });
  if (ind.macdHistogram < -Math.abs(params.macdThreshold) && ind.macdLine < ind.macdSignal)
    signals.push({ side: "short", strategy: "macd_crossover", strength: Math.min(Math.abs(ind.macdHistogram) / Math.max(Math.abs(ind.macdLine), 0.001), 1) });
  if (candles.length >= params.momentumLookback + 1) {
    const rc = candles.slice(-params.momentumLookback).map((c) => c.close);
    const mom = ((rc[rc.length - 1] - rc[0]) / rc[0]) * 100;
    if (mom > 2 && ind.ema12 > ind.ema26) signals.push({ side: "long", strategy: "momentum_breakout", strength: Math.min(mom / 5, 1) });
    if (mom < -2 && ind.ema12 < ind.ema26) signals.push({ side: "short", strategy: "momentum_breakout", strength: Math.min(Math.abs(mom) / 5, 1) });
  }
  const bw = ind.bollingerUpper - ind.bollingerLower;
  if (bw > 0) {
    if (currentPrice <= ind.bollingerLower) signals.push({ side: "long", strategy: "mean_reversion", strength: (ind.bollingerLower - currentPrice) / bw + 0.5 });
    if (currentPrice >= ind.bollingerUpper) signals.push({ side: "short", strategy: "mean_reversion", strength: (currentPrice - ind.bollingerUpper) / bw + 0.5 });
  }

  if (signals.length === 0) return null;
  signals.sort((a, b) => b.strength - a.strength);
  return { side: signals[0].side, strategy: signals[0].strategy };
}

// ─── Price Path Generation ──────────────────────────────────────────

async function fetchRealHistory(symbol: string): Promise<Candle[]> {
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=1000`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data as unknown[][]).map((d) => ({
      open: parseFloat(d[1] as string), high: parseFloat(d[2] as string),
      low: parseFloat(d[3] as string), close: parseFloat(d[4] as string),
      volume: parseFloat(d[5] as string),
    }));
  } catch { return []; }
}

function calibrateGBM(candles: Candle[]): { mu: number; sigma: number; startPrice: number } {
  if (candles.length < 10) return { mu: 0.0002, sigma: 0.03, startPrice: 50000 };
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) returns.push(Math.log(candles[i].close / candles[i - 1].close));
  }
  const n = returns.length;
  const mu = returns.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(returns.reduce((s, r) => s + (r - mu) ** 2, 0) / n);
  return { mu, sigma, startPrice: candles[candles.length - 1].close };
}

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatePricePath(startPrice: number, mu: number, sigma: number, periods: number, rng: () => number): number[] {
  const prices: number[] = [startPrice];
  for (let i = 1; i < periods; i++) {
    const u1 = Math.max(rng(), 1e-10), u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    prices.push(Math.max(prices[i - 1] * Math.exp(mu + sigma * z), 0.01));
  }
  return prices;
}

// ─── Backtest Engine ───────────────────────────────────────────────

function runSingleBacktest(
  pricePaths: Map<string, number[]>,
  params: BacktestParams,
  startingCapital: number,
): BacktestResult {
  const symbols = Array.from(pricePaths.keys());
  const totalPeriods = pricePaths.get(symbols[0])?.length ?? 0;
  let equity = startingCapital;
  const openTrades: Trade[] = [];
  const closedTrades: ClosedTrade[] = [];
  const equityCurve: { period: number; equity: number }[] = [];
  let peakEquity = startingCapital, maxDrawdown = 0;
  const candleBuffers = new Map<string, Candle[]>();
  for (const sym of symbols) candleBuffers.set(sym, []);

  for (let period = 0; period < totalPeriods; period++) {
    for (const sym of symbols) {
      const prices = pricePaths.get(sym)!;
      const prev = period > 0 ? prices[period - 1] : prices[0];
      const high = Math.max(prices[period], prev) * 1.002;
      const low = Math.min(prices[period], prev) * 0.998;
      candleBuffers.get(sym)!.push({ open: prev, high, low, close: prices[period], volume: 1000 });
      const buf = candleBuffers.get(sym)!;
      if (buf.length > 100) buf.shift();
    }

    // Check exits on open trades
    for (let i = openTrades.length - 1; i >= 0; i--) {
      const trade = openTrades[i];
      const cp = pricePaths.get(trade.symbol)![period];
      const isLong = trade.side === "long";
      let shouldClose = false, exitPrice = cp, exitReason = "";

      if (isLong) {
        if (cp <= trade.stopLoss) { shouldClose = true; exitPrice = trade.stopLoss; exitReason = "stop_loss"; }
        else if (cp >= trade.takeProfit) { shouldClose = true; exitPrice = trade.takeProfit; exitReason = "take_profit"; }
      } else {
        if (cp >= trade.stopLoss) { shouldClose = true; exitPrice = trade.stopLoss; exitReason = "stop_loss"; }
        else if (cp <= trade.takeProfit) { shouldClose = true; exitPrice = trade.takeProfit; exitReason = "take_profit"; }
      }

      if (shouldClose) {
        const hold = period - trade.entryPeriod;
        const pnl = isLong ? (exitPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - exitPrice) * trade.quantity;
        const posVal = trade.entryPrice * trade.quantity;
        equity += posVal + pnl;
        closedTrades.push({ strategy: trade.strategy, side: trade.side, entryPrice: trade.entryPrice, exitPrice, pnl, pnlPct: (pnl / posVal) * 100, holdPeriods: hold, exitReason, period: trade.entryPeriod });
        openTrades.splice(i, 1);
      }
    }

    // Check for new entries
    for (const sym of symbols) {
      const candles = candleBuffers.get(sym)!;
      if (candles.length < 50) continue;
      const cp = pricePaths.get(sym)![period];
      const hasOpen = openTrades.some((t) => t.symbol === sym);
      if (hasOpen) continue;
      const signal = evaluateStrategies(candles, cp, params);
      if (signal && equity > 10) {
        const posVal = equity * (params.maxPositionPct / 100);
        const qty = posVal / cp;
        const isLong = signal.side === "long";
        openTrades.push({
          side: signal.side, strategy: signal.strategy, symbol: sym,
          entryPrice: cp, entryPeriod: period, quantity: qty,
          stopLoss: isLong ? cp * (1 - params.stopLossPct / 100) : cp * (1 + params.stopLossPct / 100),
          takeProfit: isLong ? cp * (1 + params.takeProfitPct / 100) : cp * (1 - params.takeProfitPct / 100),
        });
        equity -= posVal;
      }
    }

    // Track equity
    const totalEquity = equity + openTrades.reduce((s, t) => {
      const cp = pricePaths.get(t.symbol)![period];
      return s + (t.side === "long" ? (cp - t.entryPrice) : (t.entryPrice - cp)) * t.quantity;
    }, 0);
    equityCurve.push({ period, equity: totalEquity });
    if (totalEquity > peakEquity) peakEquity = totalEquity;
    const dd = ((peakEquity - totalEquity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Close remaining
  for (const trade of openTrades) {
    const lastPrice = pricePaths.get(trade.symbol)![totalPeriods - 1];
    const isLong = trade.side === "long";
    const pnl = isLong ? (lastPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - lastPrice) * trade.quantity;
    const posVal = trade.entryPrice * trade.quantity;
    equity += posVal + pnl;
    closedTrades.push({ strategy: trade.strategy, side: trade.side, entryPrice: trade.entryPrice, exitPrice: lastPrice, pnl, pnlPct: (pnl / posVal) * 100, holdPeriods: totalPeriods - 1 - trade.entryPeriod, exitReason: "end_of_sim", period: trade.entryPeriod });
  }

  const wins = closedTrades.filter((t) => t.pnl >= 0);
  const losses = closedTrades.filter((t) => t.pnl < 0);
  const totalWinPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalReturnPct = ((equity - startingCapital) / startingCapital) * 100;
  const years = totalPeriods / 365;
  const annualizedReturnPct = years > 0 && equity > 0 ? (Math.pow(equity / startingCapital, 1 / years) - 1) * 100 : 0;

  const returns = closedTrades.map((t) => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStd = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideStd = downsideReturns.length > 1 ? Math.sqrt(downsideReturns.reduce((s, r) => s + r * r, 0) / downsideReturns.length) : 0;
  const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0;

  const strategyBreakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }> = {};
  for (const t of closedTrades) {
    if (!strategyBreakdown[t.strategy]) strategyBreakdown[t.strategy] = { trades: 0, wins: 0, pnl: 0, winRate: 0 };
    strategyBreakdown[t.strategy].trades++;
    if (t.pnl >= 0) strategyBreakdown[t.strategy].wins++;
    strategyBreakdown[t.strategy].pnl += t.pnl;
  }
  for (const key of Object.keys(strategyBreakdown)) {
    const sb = strategyBreakdown[key];
    sb.winRate = sb.trades > 0 ? (sb.wins / sb.trades) * 100 : 0;
  }

  return {
    finalEquity: equity, totalReturnPct, annualizedReturnPct, maxDrawdownPct: maxDrawdown,
    sharpeRatio: sharpe, sortinoRatio: sortino,
    totalTrades: closedTrades.length, winningTrades: wins.length, losingTrades: losses.length,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
    avgWin: wins.length > 0 ? totalWinPnl / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLossPnl / losses.length : 0,
    profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 0,
    bestTradePct: closedTrades.length > 0 ? Math.max(...closedTrades.map((t) => t.pnlPct)) : 0,
    worstTradePct: closedTrades.length > 0 ? Math.min(...closedTrades.map((t) => t.pnlPct)) : 0,
    avgHoldPeriods: closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + t.holdPeriods, 0) / closedTrades.length : 0,
    equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 300)) === 0),
    strategyBreakdown, trades: closedTrades,
  };
}

// ─── Coordinate Descent Optimizer ──────────────────────────────────

function scoreResult(r: BacktestResult): number {
  return r.sharpeRatio - r.maxDrawdownPct * 0.1 + r.annualizedReturnPct * 0.05;
}

function optimizeParams(
  pricePaths: Map<string, number[]>,
  base: BacktestParams,
  startingCapital: number,
): { params: BacktestParams; result: BacktestResult } {
  let best = { ...base };
  let bestResult = runSingleBacktest(pricePaths, best, startingCapital);
  let bestScore = scoreResult(bestResult);

  const paramGrids: Record<string, number[]> = {
    rsiOversold: [20, 25, 30, 35],
    rsiOverbought: [65, 70, 75, 80],
    stopLossPct: [1, 2, 3, 5],
    takeProfitPct: [2, 4, 6, 8],
    momentumLookback: [3, 5, 8, 12],
  };

  // Coordinate descent: optimize one parameter at a time, 1 round
  for (let round = 0; round < 1; round++) {
    for (const [key, values] of Object.entries(paramGrids)) {
      for (const val of values) {
        if (key === "takeProfitPct" && val <= best.stopLossPct) continue;
        const candidate = { ...best, [key]: val };
        const result = runSingleBacktest(pricePaths, candidate, startingCapital);
        const score = scoreResult(result);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
          bestResult = result;
        }
      }
    }
  }

  return { params: best, result: bestResult };
}

// ─── Main Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/backtest-engine", "");

    if (path === "/run") {
      const body = await req.json().catch(() => ({}));
      const years: number = body.years ?? 50;
      const iterations: number = Math.min(body.iterations ?? 3, 5);
      const startingCapital: number = body.startingCapital ?? 10000;
      const optimize: boolean = body.optimize ?? true;
      const symbols: string[] = body.symbols ?? ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

      const { data: runRecord } = await supabase.from("backtest_runs").insert({
        label: `${years}-Year Monte Carlo${optimize ? " + Optimization" : ""}`,
        years, iterations, starting_capital: startingCapital, status: "running", strategy_params: body.params ?? {},
      }).select().single();
      const runId = runRecord.id;

      // Fetch real history to calibrate GBM
      const calibrationData = new Map<string, { mu: number; sigma: number; startPrice: number }>();
      for (const sym of symbols) {
        calibrationData.set(sym, calibrateGBM(await fetchRealHistory(sym)));
      }

      // Daily candles: 50 years = ~18,250 periods. Cap at 5000 for performance.
      const periodsPerIteration = Math.min(years * 365, 2000);
      const actualYears = periodsPerIteration / 365;

      const baseParams: BacktestParams = {
        rsiOversold: body.params?.rsiOversold ?? 30,
        rsiOverbought: body.params?.rsiOverbought ?? 70,
        macdThreshold: body.params?.macdThreshold ?? 0,
        momentumLookback: body.params?.momentumLookback ?? 5,
        stopLossPct: body.params?.stopLossPct ?? 2,
        takeProfitPct: body.params?.takeProfitPct ?? 4,
        maxPositionPct: body.params?.maxPositionPct ?? 10,
        activeStrategies: body.params?.activeStrategies ?? [
          "rsi_oversold", "rsi_overbought", "macd_crossover", "momentum_breakout", "mean_reversion",
        ],
      };

      // Monte Carlo with base params
      let bestResult: BacktestResult | null = null;
      let worstResult: BacktestResult | null = null;
      let sumEquity = 0, sumDD = 0, sumSharpe = 0, sumTrades = 0, sumWinRate = 0;

      for (let iter = 0; iter < iterations; iter++) {
        const rng = makeRng(iter * 1000 + 42);
        const pricePaths = new Map<string, number[]>();
        for (const [sym, cal] of calibrationData) {
          pricePaths.set(sym, generatePricePath(cal.startPrice, cal.mu, cal.sigma, periodsPerIteration, rng));
        }
        const result = runSingleBacktest(pricePaths, baseParams, startingCapital);
        if (!bestResult || scoreResult(result) > scoreResult(bestResult)) bestResult = result;
        if (!worstResult || scoreResult(result) < scoreResult(worstResult)) worstResult = result;
        sumEquity += result.finalEquity;
        sumDD += result.maxDrawdownPct;
        sumSharpe += result.sharpeRatio;
        sumTrades += result.totalTrades;
        sumWinRate += result.winRate;
      }

      const mcAvg = {
        finalEquity: sumEquity / iterations,
        maxDrawdownPct: sumDD / iterations,
        sharpeRatio: sumSharpe / iterations,
        totalTrades: Math.round(sumTrades / iterations),
        winRate: sumWinRate / iterations,
      };

      // Optimize on a fixed seed path
      let optimizedParams = baseParams;
      let optimizedResult = bestResult!;

      if (optimize) {
        const rng = makeRng(42);
        const optPaths = new Map<string, number[]>();
        for (const [sym, cal] of calibrationData) {
          optPaths.set(sym, generatePricePath(cal.startPrice, cal.mu, cal.sigma, periodsPerIteration, rng));
        }
        const opt = optimizeParams(optPaths, baseParams, startingCapital);
        optimizedParams = opt.params;
        optimizedResult = opt.result;
      }

      // Store trades (limit 200)
      const sampleTrades = optimizedResult.trades.slice(0, 200);
      if (sampleTrades.length > 0) {
        const rows = sampleTrades.map((t) => ({
          run_id: runId, iteration: 0, symbol: "MIXED", side: t.side, strategy: t.strategy,
          entry_price: t.entryPrice, exit_price: t.exitPrice, pnl: t.pnl, pnl_pct: t.pnlPct,
          hold_periods: t.holdPeriods, exit_reason: t.exitReason, period: t.period,
        }));
        for (let i = 0; i < rows.length; i += 100) {
          await supabase.from("backtest_trades").insert(rows.slice(i, i + 100));
        }
      }

      await supabase.from("backtest_runs").update({
        final_equity: optimizedResult.finalEquity,
        total_return_pct: optimizedResult.totalReturnPct,
        annualized_return_pct: optimizedResult.annualizedReturnPct,
        max_drawdown_pct: optimizedResult.maxDrawdownPct,
        sharpe_ratio: optimizedResult.sharpeRatio,
        sortino_ratio: optimizedResult.sortinoRatio,
        total_trades: optimizedResult.totalTrades,
        winning_trades: optimizedResult.winningTrades,
        losing_trades: optimizedResult.losingTrades,
        win_rate: optimizedResult.winRate,
        avg_win: optimizedResult.avgWin, avg_loss: optimizedResult.avgLoss,
        profit_factor: optimizedResult.profitFactor,
        best_trade_pct: optimizedResult.bestTradePct,
        worst_trade_pct: optimizedResult.worstTradePct,
        avg_hold_periods: optimizedResult.avgHoldPeriods,
        strategy_params: { base: baseParams, optimized: optimizedParams },
        equity_curve: optimizedResult.equityCurve,
        strategy_breakdown: optimizedResult.strategyBreakdown,
        status: "completed",
      }).eq("id", runId);

      await supabase.from("audit_log").insert({
        event_type: "backtest_complete", entity_type: "backtest_runs", entity_id: runId,
        message: `${actualYears.toFixed(0)}yr backtest: ${optimizedResult.totalTrades} trades, ${optimizedResult.totalReturnPct.toFixed(1)}% return, Sharpe ${optimizedResult.sharpeRatio.toFixed(2)}, DD ${optimizedResult.maxDrawdownPct.toFixed(1)}%`,
        metadata: { run_id: runId, years: actualYears, iterations, optimized: optimize },
      });

      return new Response(JSON.stringify({
        runId, years: actualYears, iterations, baseParams, optimizedParams,
        optimized: {
          finalEquity: optimizedResult.finalEquity,
          totalReturnPct: optimizedResult.totalReturnPct,
          annualizedReturnPct: optimizedResult.annualizedReturnPct,
          maxDrawdownPct: optimizedResult.maxDrawdownPct,
          sharpeRatio: optimizedResult.sharpeRatio,
          sortinoRatio: optimizedResult.sortinoRatio,
          totalTrades: optimizedResult.totalTrades,
          winningTrades: optimizedResult.winningTrades,
          losingTrades: optimizedResult.losingTrades,
          winRate: optimizedResult.winRate,
          avgWin: optimizedResult.avgWin, avgLoss: optimizedResult.avgLoss,
          profitFactor: optimizedResult.profitFactor,
          bestTradePct: optimizedResult.bestTradePct,
          worstTradePct: optimizedResult.worstTradePct,
          avgHoldPeriods: optimizedResult.avgHoldPeriods,
          strategyBreakdown: optimizedResult.strategyBreakdown,
          equityCurve: optimizedResult.equityCurve,
        },
        monteCarlo: {
          best: { finalEquity: bestResult!.finalEquity, sharpeRatio: bestResult!.sharpeRatio, maxDrawdownPct: bestResult!.maxDrawdownPct },
          worst: { finalEquity: worstResult!.finalEquity, sharpeRatio: worstResult!.sharpeRatio, maxDrawdownPct: worstResult!.maxDrawdownPct },
          average: mcAvg,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "/results") {
      const { data: runs } = await supabase.from("backtest_runs").select("*").order("created_at", { ascending: false }).limit(10);
      return new Response(JSON.stringify({ runs: runs ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "/trades") {
      const runId = url.searchParams.get("runId");
      if (!runId) return new Response(JSON.stringify({ error: "Missing runId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: trades } = await supabase.from("backtest_trades").select("*").eq("run_id", runId).order("period", { ascending: true }).limit(500);
      return new Response(JSON.stringify({ trades: trades ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown route. Use /run, /results, or /trades" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("backtest-engine error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
