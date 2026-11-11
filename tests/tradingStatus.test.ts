import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeClosePositions, parseClosePositionsResult, positionUnrealizedPnl, totalPositionPnl, recordedTradeStats, readTradingResponse } from '../src/lib/tradingStatus.ts';

test('failed market sale stays visibly incomplete even when other positions close', () => {
  const result = parseClosePositionsResult({ closedByRules: 0, forceClosed: 2, total: 2, failed: 1, remainingOpen: 1, complete: false,
    failures: [{ tradeId: 'unfilled', symbol: 'AXSUSDT', error: 'Insufficient balance' }] });
  assert.match(describeClosePositions(result), /2 positions closed/);
  assert.match(describeClosePositions(result), /1 close failed; 1 remain open/);
  assert.match(describeClosePositions(result), /AXSUSDT: Insufficient balance/);
});

test('legacy and contradictory close responses cannot claim success', () => {
  assert.throws(() => parseClosePositionsResult({ total: 1 }), /without reliable completion details/);
  assert.throws(() => parseClosePositionsResult({ closedByRules: 0, forceClosed: 1, total: 1, failed: 1, remainingOpen: 1, complete: true, failures: [] }));
  assert.throws(() => parseClosePositionsResult({ closedByRules: 0, forceClosed: 1, total: 2, failed: 0, remainingOpen: 0, complete: true, failures: [] }));
});

test('zero positions is valid only with a complete observed response', () => {
  const result = parseClosePositionsResult({ closedByRules: 0, forceClosed: 0, total: 0, failed: 0, remainingOpen: 0, complete: true, failures: [] });
  assert.match(describeClosePositions(result), /No tracked positions remain open/);
});

test('missing quotes withhold aggregate P&L rather than masquerading as break-even', () => {
  assert.equal(totalPositionPnl([{ unrealized_pnl: 4 }, { unrealized_pnl: null, price_available: false }]), null);
  assert.equal(totalPositionPnl([{ unrealized_pnl: NaN }]), null);
  assert.equal(totalPositionPnl([]), 0);
});

test('partial-exit profit is excluded from unrealized P&L', () => {
  assert.equal(positionUnrealizedPnl({ unrealized_pnl: 12, runner_pnl: 2, partial_pnl: 10 }), 2);
  assert.equal(positionUnrealizedPnl({ unrealized_pnl: 12, partial_pnl: 10 }), 2);
  assert.equal(positionUnrealizedPnl({ unrealized_pnl: 12, runner_pnl: null }), null);
});

test('profit factor uses gross profit over gross loss; flat trades are not wins', () => {
  const stats = recordedTradeStats([{ pnl: 2 }, { pnl: 2 }, { pnl: -1 }, { pnl: 0 }]);
  assert.equal(stats.profitFactor, 4);
  assert.equal(stats.winRate, 50);
  assert.equal(stats.breakeven, 1);
  assert.equal(recordedTradeStats([]).winRate, null);
  assert.equal(recordedTradeStats([]).profitFactor, null);
});

test('HTTP failure and invalid JSON remain errors', async () => {
  await assert.rejects(readTradingResponse(new Response('{"error":"Exchange unavailable"}', { status: 503 })), /Exchange unavailable/);
  await assert.rejects(readTradingResponse(new Response('not json', { status: 200 })), /invalid response/);
});
