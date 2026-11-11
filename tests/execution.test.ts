import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRealizedPnl, type BinanceTrade } from '../src/lib/tradePnl.ts';
import { buildExecutionOrders } from '../src/lib/executionOrders.ts';
import { summarizeExecution, isSnapshotStale } from '../src/lib/executionHealth.ts';
import { collectHistorySymbols, mapInBatches } from '../supabase/functions/binance-account/history.ts';

const fill = (id: number, isBuyer: boolean, qty: string, quoteQty: string, overrides: Partial<BinanceTrade> = {}): BinanceTrade => ({
  id, orderId: id, isBuyer, qty, quoteQty, price: String(Number(quoteQty) / Number(qty)),
  commission: '0', commissionAsset: 'USDT', time: id * 1000, ...overrides,
});

test('buy fees paid in base reduce inventory and are counted once in cost basis', () => {
  const pnl = computeRealizedPnl('AXSUSDT', [
    fill(1, true, '10', '100', { commission: '1', commissionAsset: 'AXS' }),
    fill(2, false, '9', '108'),
  ]).get(2)!;
  assert.equal(pnl.complete, true);
  assert.ok(Math.abs(pnl.realizedPnl - 8) < 1e-10);
});

test('missing buy history and unvalued third-asset commissions are not counted as profit', () => {
  assert.equal(computeRealizedPnl('AXSUSDT', [fill(2, false, '9', '108')]).get(2)!.complete, false);
  const result = computeRealizedPnl('AXSUSDT', [
    fill(1, true, '10', '100', { commission: '0.01', commissionAsset: 'BNB' }), fill(2, false, '10', '110'),
  ]).get(2)!;
  assert.equal(result.complete, false);
});

test('base fees on sells consume inventory and duplicate fills are ignored', () => {
  const buy = fill(1, true, '10', '100');
  const sell = fill(2, false, '9', '108', { commission: '1', commissionAsset: 'AXS' });
  const pnl = computeRealizedPnl('AXSUSDT', [buy, buy, sell]).get(2)!;
  assert.equal(pnl.complete, true);
  assert.equal(pnl.realizedPnl, 8);
});

test('truncated history never produces confirmed P&L or a misleading subtotal', () => {
  const orders = buildExecutionOrders([{
    symbol: 'AXSUSDT', tradesMayBeTruncated: true,
    trades: [fill(1, true, '10', '100'), fill(2, false, '10', '110')],
    orders: [{ orderId: 2, side: 'SELL', status: 'FILLED', type: 'MARKET', price: '11', origQty: '10', executedQty: '10', cummulativeQuoteQty: '110', time: 2000 }],
  }], new Map());
  assert.equal(orders[0].pnl!.complete, false);
  assert.deepEqual(summarizeExecution(orders), { realizedPnl: 0, incompleteSells: 1, matchedSells: 0, openOrders: 0, filledOrders: 1 });
});

test('discovery includes active balances, open orders, configured pairs and historical pairs', () => {
  assert.deepEqual(collectHistorySymbols({ held: ['AXS', 'USDT'], openOrders: ['DOGEUSDT'], configured: ['IMXUSDT', 'AXSUSDT'], tracked: ['SOLUSDT', 'invalid'] }), {
    symbols: ['DOGEUSDT', 'AXSUSDT', 'IMXUSDT', 'SOLUSDT'], omittedSymbols: [],
  });
  const bounded = collectHistorySymbols({ held: [], openOrders: [], configured: [], tracked: Array.from({ length: 45 }, (_, i) => `COIN${i}USDT`) });
  assert.equal(bounded.symbols.length, 40);
  assert.equal(bounded.omittedSymbols.length, 5);
});

test('history batches enforce concurrency limits', async () => {
  let active = 0, maximum = 0;
  const values = await mapInBatches([1, 2, 3, 4, 5], 2, async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--; return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});

test('missing, invalid, future and old timestamps cannot look current', () => {
  const now = Date.parse('2026-11-11T18:45:00Z');
  for (const stamp of [null, 'invalid', '2026-11-11T18:40:00Z', '2026-11-11T18:50:00Z']) assert.equal(isSnapshotStale(stamp, now), true);
  assert.equal(isSnapshotStale('2026-11-11T18:44:30Z', now), false);
});
