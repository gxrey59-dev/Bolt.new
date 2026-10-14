export interface Candle { open: number; high: number; low: number; close: number; volume: number; }
interface Indicators {
rsi: number; macdLine: number; macdSignal: number; macdHistogram: number;
ema12: number; ema26: number; sma20: number; sma50: number; atr: number;
bollingerUpper: number; bollingerMiddle: number; bollingerLower: number;
}
interface Trade {
side: "long" | "short"; strategy: string; symbol: string;
entryPrice: number; entryPeriod: number; quantity: number;
entryFee: number;
stopLoss: number; takeProfit: number;
}
interface ClosedTrade {
symbol: string; strategy: string; side: "long" | "short"; entryPrice: number; exitPrice: number;
pnl: number; pnlPct: number; holdPeriods: number; exitReason: string; period: number;
}
export interface BacktestParams {
rsiOversold: number; rsiOverbought: number; macdThreshold: number;
momentumLookback: number; stopLossPct: number; takeProfitPct: number;
maxPositionPct: number; activeStrategies: string[];
feeBps?: number; slippageBps?: number;
}
export interface BacktestResult {
finalEquity: number; totalReturnPct: number; annualizedReturnPct: number;
maxDrawdownPct: number; sharpeRatio: number; sortinoRatio: number;
totalTrades: number; winningTrades: number; losingTrades: number;
winRate: number; avgWin: number; avgLoss: number; profitFactor: number;
bestTradePct: number; worstTradePct: number; avgHoldPeriods: number;
equityCurve: { period: number; equity: number }[];
strategyBreakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
trades: ClosedTrade[];
}
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
const enabled = signals.filter(s => params.activeStrategies.includes(s.strategy));
if (enabled.length === 0) return null;
enabled.sort((a, b) => b.strength - a.strength);
return { side: enabled[0].side, strategy: enabled[0].strategy };
}
export function calibrateGBM(candles: Candle[]): { mu: number; sigma: number; startPrice: number } {
if (candles.length < 10 || candles.some(c => !Number.isFinite(c.close) || c.close <= 0)) {
throw new Error("Insufficient or invalid market history for calibration");
}
const returns: number[] = [];
for (let i = 1; i < candles.length; i++) {
if (candles[i - 1].close > 0) returns.push(Math.log(candles[i].close / candles[i - 1].close));
}
const n = returns.length;
const mu = returns.reduce((a, b) => a + b, 0) / n;
const sigma = Math.sqrt(returns.reduce((s, r) => s + (r - mu) ** 2, 0) / n);
return { mu, sigma, startPrice: candles[candles.length - 1].close };
}
export function makeRng(seed: number): () => number {
let s = seed;
return () => {
s |= 0; s = (s + 0x6D2B79F5) | 0;
let t = Math.imul(s ^ (s >>> 15), 1 | s);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
export function generatePricePath(startPrice: number, mu: number, sigma: number, periods: number, rng: () => number): number[] {
const prices: number[] = [startPrice];
for (let i = 1; i < periods; i++) {
const u1 = Math.max(rng(), 1e-10), u2 = rng();
const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
prices.push(Math.max(prices[i - 1] * Math.exp(mu + sigma * z), 0.01));
}
return prices;
}
export function runSingleBacktest(
pricePaths: Map<string, number[]>,
params: BacktestParams,
startingCapital: number,
): BacktestResult {
const symbols = Array.from(pricePaths.keys());
const totalPeriods = pricePaths.get(symbols[0])?.length ?? 0;
const feeBps = params.feeBps ?? 10;
const slippageBps = params.slippageBps ?? 5;
if (!Number.isFinite(startingCapital) || startingCapital <= 0 || totalPeriods < 2 ||
!Number.isFinite(params.maxPositionPct) || params.maxPositionPct <= 0 || params.maxPositionPct > 100 ||
!Array.isArray(params.activeStrategies) ||
![feeBps, slippageBps].every(v => Number.isFinite(v) && v >= 0 && v <= 1000) ||
![params.stopLossPct, params.takeProfitPct].every(v => Number.isFinite(v) && v > 0 && v < 100) ||
![params.rsiOversold, params.rsiOverbought].every(v => Number.isFinite(v) && v > 0 && v < 100) ||
!Number.isFinite(params.macdThreshold) ||
!Number.isInteger(params.momentumLookback) || params.momentumLookback < 2 || params.momentumLookback > 100 ||
symbols.some(sym => pricePaths.get(sym)!.length !== totalPeriods ||
pricePaths.get(sym)!.some(p => !Number.isFinite(p) || p <= 0))) {
throw new Error("Invalid simulation inputs");
}
const feeRate = feeBps / 10000, slip = slippageBps / 10000;
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
for (let i = openTrades.length - 1; i >= 0; i--) {
const trade = openTrades[i];
const cp = pricePaths.get(trade.symbol)![period];
const isLong = trade.side === "long";
let shouldClose = false, exitPrice = cp, exitReason = "";
if (isLong) {
if (cp <= trade.stopLoss) { shouldClose = true; exitPrice = cp; exitReason = "stop_loss"; }
else if (cp >= trade.takeProfit) { shouldClose = true; exitPrice = trade.takeProfit; exitReason = "take_profit"; }
} else {
if (cp >= trade.stopLoss) { shouldClose = true; exitPrice = cp; exitReason = "stop_loss"; }
else if (cp <= trade.takeProfit) { shouldClose = true; exitPrice = trade.takeProfit; exitReason = "take_profit"; }
}
if (shouldClose) {
const hold = period - trade.entryPeriod;
exitPrice *= isLong ? 1 - slip : 1 + slip;
const grossPnl = isLong ? (exitPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - exitPrice) * trade.quantity;
const exitFee = exitPrice * trade.quantity * feeRate;
const pnl = grossPnl - trade.entryFee - exitFee;
const posVal = trade.entryPrice * trade.quantity;
equity += posVal + grossPnl - exitFee;
closedTrades.push({ symbol: trade.symbol, strategy: trade.strategy, side: trade.side, entryPrice: trade.entryPrice, exitPrice, pnl, pnlPct: (pnl / posVal) * 100, holdPeriods: hold, exitReason, period: trade.entryPeriod });
openTrades.splice(i, 1);
}
}
for (const sym of symbols) {
const candles = candleBuffers.get(sym)!;
if (candles.length < 50) continue;
const cp = pricePaths.get(sym)![period];
const hasOpen = openTrades.some((t) => t.symbol === sym);
if (hasOpen) continue;
const signal = evaluateStrategies(candles, cp, params);
if (signal && equity > 10 && period < totalPeriods - 1) {
const posVal = equity * (params.maxPositionPct / 100) / (1 + feeRate);
const isLong = signal.side === "long";
const entryPrice = cp * (isLong ? 1 + slip : 1 - slip);
const qty = posVal / entryPrice;
const entryFee = posVal * feeRate;
openTrades.push({
side: signal.side, strategy: signal.strategy, symbol: sym,
entryPrice, entryPeriod: period, quantity: qty, entryFee,
stopLoss: isLong ? entryPrice * (1 - params.stopLossPct / 100) : entryPrice * (1 + params.stopLossPct / 100),
takeProfit: isLong ? entryPrice * (1 + params.takeProfitPct / 100) : entryPrice * (1 - params.takeProfitPct / 100),
});
equity -= posVal + entryFee;
}
}
const totalEquity = equity + openTrades.reduce((s, t) => {
const cp = pricePaths.get(t.symbol)![period];
return s + t.entryPrice * t.quantity +
(t.side === "long" ? (cp - t.entryPrice) : (t.entryPrice - cp)) * t.quantity;
}, 0);
equityCurve.push({ period, equity: totalEquity });
if (totalEquity > peakEquity) peakEquity = totalEquity;
const dd = ((peakEquity - totalEquity) / peakEquity) * 100;
if (dd > maxDrawdown) maxDrawdown = dd;
}
for (const trade of openTrades) {
const isLong = trade.side === "long";
const lastPrice = pricePaths.get(trade.symbol)![totalPeriods - 1] * (isLong ? 1 - slip : 1 + slip);
const grossPnl = isLong ? (lastPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - lastPrice) * trade.quantity;
const exitFee = lastPrice * trade.quantity * feeRate;
const pnl = grossPnl - trade.entryFee - exitFee;
const posVal = trade.entryPrice * trade.quantity;
equity += posVal + grossPnl - exitFee;
closedTrades.push({ symbol: trade.symbol, strategy: trade.strategy, side: trade.side, entryPrice: trade.entryPrice, exitPrice: lastPrice, pnl, pnlPct: (pnl / posVal) * 100, holdPeriods: totalPeriods - 1 - trade.entryPeriod, exitReason: "end_of_sim", period: trade.entryPeriod });
}
equityCurve[equityCurve.length - 1].equity = equity;
peakEquity = startingCapital;
maxDrawdown = 0;
for (const point of equityCurve) {
peakEquity = Math.max(peakEquity, point.equity);
maxDrawdown = Math.max(maxDrawdown, (peakEquity - point.equity) / peakEquity * 100);
}
const wins = closedTrades.filter((t) => t.pnl > 0);
const losses = closedTrades.filter((t) => t.pnl < 0);
const totalWinPnl = wins.reduce((s, t) => s + t.pnl, 0);
const totalLossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
const totalReturnPct = ((equity - startingCapital) / startingCapital) * 100;
const years = (totalPeriods - 1) / 365;
const annualizedReturnPct = years > 0 && equity > 0 ? (Math.pow(equity / startingCapital, 1 / years) - 1) * 100 : 0;
const returns = equityCurve.slice(1).map((p, i) => {
const prev = equityCurve[i].equity;
return prev > 0 ? p.equity / prev - 1 : 0;
});
const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
const returnStd = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 0;
const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(365) : 0;
const downsideStd = returns.length > 0 ? Math.sqrt(returns.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / returns.length) : 0;
const sortino = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(365) : 0;
const strategyBreakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }> = {};
for (const t of closedTrades) {
if (!strategyBreakdown[t.strategy]) strategyBreakdown[t.strategy] = { trades: 0, wins: 0, pnl: 0, winRate: 0 };
strategyBreakdown[t.strategy].trades++;
if (t.pnl > 0) strategyBreakdown[t.strategy].wins++;
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
equityCurve: equityCurve.filter((_, i) => i === equityCurve.length - 1 || i % Math.max(1, Math.floor(equityCurve.length / 300)) === 0),
strategyBreakdown, trades: closedTrades,
};
}
export function scoreResult(r: BacktestResult): number {
return r.sharpeRatio - r.maxDrawdownPct * 0.1 + r.annualizedReturnPct * 0.05;
}
export function optimizeParams(
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
/** Separate seeded stress path, never used for parameter selection. Not historical validation. */
export function runSyntheticHoldout(
calibration: Map<string, { mu: number; sigma: number; startPrice: number }>,
params: BacktestParams,
periods: number,
startingCapital: number,
): BacktestResult {
const rng = makeRng(987654321);
const paths = new Map<string, number[]>();
for (const [sym, cal] of calibration) {
paths.set(sym, generatePricePath(cal.startPrice, cal.mu, cal.sigma, periods, rng));
}
return runSingleBacktest(paths, params, startingCapital);
}
