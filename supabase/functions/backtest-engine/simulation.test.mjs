import test from 'node:test';
import assert from 'node:assert/strict';
import { runSingleBacktest, calibrateGBM } from './simulation.ts';

const params = {
  rsiOversold: 30, rsiOverbought: 70, macdThreshold: 0,
  momentumLookback: 5, stopLossPct: 2, takeProfitPct: 4,
  maxPositionPct: 10, activeStrategies: ['rsi_overbought'],
  feeBps: 0, slippageBps: 0,
};
const paths = prices => new Map([['TEST', prices]]);
const flat = Array(65).fill(100);

test('disabled strategies never open positions', () => {
  const r = runSingleBacktest(paths(flat), { ...params, activeStrategies: [] }, 10000);
  assert.equal(r.totalTrades, 0);
  assert.equal(r.finalEquity, 10000);
});

test('flat-price open positions retain their locked principal in equity', () => {
  const r = runSingleBacktest(paths(flat), params, 10000);
  assert.ok(r.totalTrades > 0);
  assert.equal(r.maxDrawdownPct, 0);
  assert.ok(r.equityCurve.every(p => p.equity === 10000));
});

test('round-trip fees reduce P&L, cash, and final equity consistently', () => {
  const r = runSingleBacktest(paths(flat), { ...params, feeBps: 10 }, 10000);
  assert.ok(r.finalEquity < 10000);
  assert.equal(r.winningTrades, 0);
  assert.ok(Math.abs(r.finalEquity - 10000 - r.trades.reduce((s, t) => s + t.pnl, 0)) < 1e-8);
  assert.ok(Math.abs(r.equityCurve.at(-1).equity - r.finalEquity) < 1e-8);
});

test('adverse slippage reduces returns for shorts and longs', () => {
  for (const p of [params, { ...params, rsiOversold: 99, rsiOverbought: 99, activeStrategies: ['rsi_oversold'] }]) {
    const series = p === params ? flat : Array.from({ length: 65 }, (_, i) => 100 - i / 100);
    const baseline = runSingleBacktest(paths(series), p, 10000);
    const cost = runSingleBacktest(paths(series), { ...p, slippageBps: 10 }, 10000);
    assert.ok(baseline.totalTrades > 0);
    assert.ok(cost.finalEquity < baseline.finalEquity);
  }
});

test('price gaps cannot fill a stop at a better nonexistent threshold', () => {
  const r = runSingleBacktest(paths([...Array(50).fill(100), 110]), params, 10000);
  const stopped = r.trades.find(t => t.exitReason === 'stop_loss');
  assert.ok(stopped);
  assert.equal(stopped.exitPrice, 110);
});

test('rejects invalid capital, costs and nonaligned or invalid market paths', () => {
  for (const capital of [0, -1, Infinity, NaN])
    assert.throws(() => runSingleBacktest(paths(flat), params, capital));
  for (const feeBps of [-1, NaN, Infinity, 10001])
    assert.throws(() => runSingleBacktest(paths(flat), { ...params, feeBps }, 10000));
  assert.throws(() => runSingleBacktest(paths([100, NaN]), params, 10000));
  assert.throws(() => runSingleBacktest(paths([]), params, 10000));
  assert.throws(() => runSingleBacktest(new Map([['A', flat], ['B', [100]]]), params, 10000));
});

test('failed calibration cannot silently invent market history', () => {
  assert.throws(() => calibrateGBM([]));
  assert.throws(() => calibrateGBM(Array(20).fill({ close: 0 })));
});

test('daily portfolio metrics and final reconciliation are deterministic', () => {
  const series = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 8);
  const r = runSingleBacktest(paths(series), { ...params, activeStrategies: ['rsi_overbought', 'rsi_oversold'], feeBps: 10 }, 10000);
  assert.deepEqual(r, runSingleBacktest(paths(series), { ...params, activeStrategies: ['rsi_overbought', 'rsi_oversold'], feeBps: 10 }, 10000));
  assert.ok(Math.abs(r.finalEquity - 10000 - r.trades.reduce((s, t) => s + t.pnl, 0)) < 1e-8);
  const returns = r.equityCurve.slice(1).map((p, i) => p.equity / r.equityCurve[i].equity - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1));
  assert.ok(Math.abs(r.sharpeRatio - mean / sd * Math.sqrt(365)) < 1e-8);
});
