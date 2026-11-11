import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRevenue, isVerifiedClose, numericAmount, utcDayStart, type RevenueTrade } from '../src/lib/revenueAccounting.ts';
const stamp = Date.parse('2026-11-11T12:00:00Z');
const row = (changes: Partial<RevenueTrade> = {}): RevenueTrade => ({
  id: 'one', faction_id: 'rza', symbol: 'AXSUSDT', pnl: 4, status: 'closed', is_live: true,
  accounting_verified: true, opened_at: '2026-11-10T00:00:00Z', closed_at: '2026-11-11T10:00:00Z', ...changes,
});
test('unverified and paper returns never count toward verified profit', () => {
  const summary = summarizeRevenue([row(), row({ pnl: 900, accounting_verified: false }), row({ pnl: 1000, is_live: false }), row({ pnl: -1 })], utcDayStart(stamp), stamp);
  assert.equal(summary.verifiedPnl, 3);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.verified.length, 2);
});
test('unknown, malformed and open P&L cannot become verified closes', () => {
  for (const changes of [{ pnl: null }, { pnl: '' }, { pnl: 'NaN' }, { status: 'open' }, { accounting_verified: undefined }, { closed_at: 'invalid' }]) assert.equal(isVerifiedClose(row(changes)), false);
  assert.equal(numericAmount(null), null);
  assert.equal(numericAmount('0'), 0);
});
test('reporting uses close time, UTC cutoff, and excludes future records', () => {
  const summary = summarizeRevenue([row(), row({ closed_at: '2026-11-10T23:59:59Z' }), row({ closed_at: '2026-11-12T00:00:00Z' })], utcDayStart(stamp), stamp);
  assert.equal(summary.verified.length, 1);
  assert.equal(utcDayStart(stamp), Date.parse('2026-11-11T00:00:00Z'));
});
test('breakeven is not a loss and empty samples have no win rate', () => {
  const summary = summarizeRevenue([row({ pnl: 0 })], utcDayStart(stamp), stamp);
  assert.equal(summary.losses, 0);
  assert.equal(summary.breakeven, 1);
  assert.equal(summarizeRevenue([], 0, stamp).winRate, null);
});
