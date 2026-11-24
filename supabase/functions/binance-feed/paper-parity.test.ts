import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bookedPnl, liveReadiness, DEFAULT_READINESS } from './paper-parity.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('live P&L keeps the previous fee formula exactly', () => {
  // entry 100, exit 104, qty 1: gross 4, fee (100+104)*0.001 = 0.204
  close(bookedPnl(4, 100, 104, 1, { isLive: true, feeRate: 0.001 }), 4 - 0.204);
});

test('paper P&L pays the same fees plus slippage, so it is never rosier than live', () => {
  const live = bookedPnl(4, 100, 104, 1, { isLive: true, feeRate: 0.001 });
  const paper = bookedPnl(4, 100, 104, 1, { isLive: false, feeRate: 0.001 });
  close(paper, 4 - 204 * 0.0015);
  assert.ok(paper < live);
});

test('a tiny gross gain becomes a net loss in paper mode', () => {
  assert.ok(bookedPnl(0.1, 100, 100.1, 1, { isLive: false, feeRate: 0.001 }) < 0);
});

const day = (i: number) => new Date(Date.UTC(2026, 10, 24) + i * 3_600_000).toISOString();

test('too few trades is never ready, however good they look', () => {
  const r = liveReadiness([{ pnl: 1, positionValue: 10, closedAt: day(0) }], 100);
  assert.equal(r.ready, false);
  assert.match(r.reasons.join(' '), /Only 1 of 200/);
});

test('a consistent net edge with shallow drawdown clears every bar', () => {
  const trades = Array.from({ length: 200 }, (_, i) => ({ pnl: i % 3 === 2 ? -0.1 : 0.1, positionValue: 10, closedAt: day(i) }));
  const r = liveReadiness(trades, 100);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.ready, true);
  assert.ok(r.profitFactor! > 2 && r.profitFactor! < 2.1);
});

test('break-even results like the live record are rejected', () => {
  const trades = Array.from({ length: 205 }, (_, i) => ({ pnl: i % 2 ? 0.05 : -0.0505, positionValue: 5.2, closedAt: day(i) }));
  const r = liveReadiness(trades, 27.8);
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some(x => x.startsWith('Profit factor')));
});

test('a deep drawdown blocks readiness even when the total is positive', () => {
  const trades = [
    ...Array.from({ length: 150 }, (_, i) => ({ pnl: -0.2, positionValue: 10, closedAt: day(i) })),
    ...Array.from({ length: 150 }, (_, i) => ({ pnl: 0.5, positionValue: 10, closedAt: day(150 + i) })),
  ];
  const r = liveReadiness(trades, 100, DEFAULT_READINESS);
  assert.equal(r.ready, false);
  assert.ok(r.reasons.some(x => x.startsWith('Max drawdown')));
});
