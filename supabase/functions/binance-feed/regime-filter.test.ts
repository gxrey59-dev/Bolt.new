import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isBtcRegimeBullish, isMaxHoldExceeded, simpleMovingAverage, MAX_HOLD_HOURS } from './regime-filter.ts';

test('simple moving average uses only the most recent window', () => {
  assert.equal(simpleMovingAverage([1, 2, 3, 4, 5], 3), 4);
  assert.equal(simpleMovingAverage([1, 2], 3), null);
});

test('BTC regime is bullish only when the last close is above its 50-period average', () => {
  const rising = Array.from({ length: 50 }, (_, i) => 100 + i);
  assert.equal(isBtcRegimeBullish(rising), true);
  const falling = Array.from({ length: 50 }, (_, i) => 200 - i);
  assert.equal(isBtcRegimeBullish(falling), false);
});

test('insufficient BTC history never counts as a bullish regime', () => {
  assert.equal(isBtcRegimeBullish([1, 2, 3]), false);
});

test('positions are closed once they reach the 24 hour hold limit', () => {
  const hour = 60 * 60 * 1000;
  const opened = 1_000_000_000_000;
  assert.equal(MAX_HOLD_HOURS, 24);
  assert.equal(isMaxHoldExceeded(opened, opened + 23 * hour), false);
  assert.equal(isMaxHoldExceeded(opened, opened + 24 * hour), true);
});
