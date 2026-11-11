import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessTradingStatus } from './riskStatus.ts';

test('daily loss compares USDT to the percentage of capital, not raw percent', () => {
  const status = assessTradingStatus({ paperMode: false, killSwitch: false, liveCapital: 10, maxDailyLossPct: 5, dailyLossAccumulator: 0.4 }, false, false);
  assert.ok(status.reasons.some(reason => reason.includes('0.50 USDT threshold')));
});
test('unavailable service does not claim the kill switch is on', () => {
  const status = assessTradingStatus(null, true, false);
  assert.equal(status.level, 'yellow');
  assert.equal(status.title, 'Trading status unavailable');
});
test('confirmed kill switch always takes priority', () => {
  assert.equal(assessTradingStatus({ paperMode: true, killSwitch: true }, false, false).level, 'red');
});
