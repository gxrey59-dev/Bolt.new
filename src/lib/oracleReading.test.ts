import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOracleReading, rankStrategies, ORACLE_MIN_SAMPLE } from './oracleReading.ts';

const base = { safety: 'green' as const, closedTrades: 30, wins: 18, losses: 12, winRate: 60, avgWin: 2, avgLoss: 1, profitFactor: 3 };

test('kill switch halts the oracle regardless of performance', () => {
  assert.equal(buildOracleReading({ ...base, safety: 'red' }).verdict, 'halt');
});
test('too few closed trades keeps the oracle in learning mode', () => {
  const reading = buildOracleReading({ ...base, closedTrades: 5, wins: 3, losses: 2 });
  assert.equal(reading.verdict, 'learning');
  assert.equal(reading.sampleProgress, 5 / ORACLE_MIN_SAMPLE);
});
test('negative expected value is a caution', () => {
  assert.equal(buildOracleReading({ ...base, winRate: 30, avgWin: 1, avgLoss: 2, profitFactor: 0.5 }).verdict, 'caution');
});
test('positive edge with green safety proceeds and computes expected value per trade', () => {
  const reading = buildOracleReading(base);
  assert.equal(reading.verdict, 'proceed');
  assert.ok(Math.abs((reading.expectedValue ?? 0) - 0.8) < 1e-9);
});
test('yellow safety downgrades a positive edge to caution', () => {
  assert.equal(buildOracleReading({ ...base, safety: 'yellow' }).verdict, 'caution');
});
test('no decided trades yields no expected value', () => {
  const reading = buildOracleReading({ ...base, closedTrades: 25, wins: 0, losses: 0, winRate: null });
  assert.equal(reading.expectedValue, null);
  assert.equal(reading.verdict, 'caution');
});
test('strategies rank by win rate then sample size', () => {
  const ranked = rankStrategies({
    a: { winRate: 50, totalTrades: 10 },
    b: { winRate: 70, totalTrades: 4 },
    c: { winRate: 50, totalTrades: 20 },
  });
  assert.deepEqual(ranked.map(r => r.strategy), ['b', 'c', 'a']);
});
