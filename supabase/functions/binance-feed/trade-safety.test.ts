import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { entryClientOrderId, isDefinitiveOrderRejection, runClaimedEntry, recoverEntryTracking, exitConfirmationError, liveExitBlockReason, parseOrderReceipt, runClaimedExit, valueOpenPosition } from './trade-safety.ts';

const receipt = { orderId: 123, status: 'FILLED', executedQty: '2', cummulativeQuoteQty: '220' };

test('a fully filled exchange receipt confirms quantity and actual average exit price', () => {
  const result = parseOrderReceipt(receipt, 2);
  assert.equal(exitConfirmationError(result), null);
  assert.equal(result.averagePrice, 110);
});

test('HTTP success without a valid order ID never confirms a close', () => {
  for (const orderId of [undefined, null, 'undefined', '', 0, -1, {}, 'null']) {
    assert.match(exitConfirmationError(parseOrderReceipt({ ...receipt, orderId }, 2))!, /no valid order ID/);
  }
});

test('accepted, partial, rejected and unknown orders are not confirmed closes', () => {
  for (const status of ['NEW', 'PARTIALLY_FILLED', 'REJECTED', undefined]) {
    assert.match(exitConfirmationError(parseOrderReceipt({ ...receipt, status }, 2))!, /Reconciliation required/);
  }
});

test('even FILLED needs matching positive execution quantity and an actual price', () => {
  for (const executedQty of ['0', '1', '3', undefined, 'garbage']) {
    assert.ok(exitConfirmationError(parseOrderReceipt({ ...receipt, executedQty }, 2)));
  }
  for (const cummulativeQuoteQty of ['0', '-1', undefined, 'garbage']) {
    assert.ok(exitConfirmationError(parseOrderReceipt({ ...receipt, cummulativeQuoteQty }, 2)));
  }
});

test('failed exchange result preserves its detail', () => {
  assert.equal(exitConfirmationError({ orderId: null, error: 'Insufficient balance' }), 'Insufficient balance');
});

test('uncertain execution blocks another exit attempt until reconciled', () => {
  assert.equal(liveExitBlockReason({ binance_order_id: '123', execution_error: 'Reconciliation required: timeout' }), 'Reconciliation required: timeout');
  assert.equal(liveExitBlockReason({ binance_order_id: '123', execution_error: 'Insufficient balance' }), null);
  assert.match(liveExitBlockReason({ binance_order_id: null })!, /entry order ID is missing/);
});

const position = { symbol: 'ETHUSDT', side: 'long', entry_price: 100, quantity: 2, remaining_quantity: 1, position_value: 200, partial_exit_pnl: 5, partial_exit_price: 105 };

test('missing or invalid quotes preserve the position with unknown valuation', () => {
  for (const quote of [undefined, NaN, Infinity, 0, -1]) {
    const result = valueOpenPosition(position, quote);
    assert.equal(result.symbol, 'ETHUSDT');
    assert.equal(result.price_available, false);
    assert.equal(result.current_price, null);
    assert.equal(result.unrealized_pnl, null);
    assert.equal(result.pnl_pct, null);
    assert.equal(result.partial_pnl, 5);
  }
});

test('valuation uses the remaining quantity and already-realized partial P&L once', () => {
  const result = valueOpenPosition(position, 110);
  assert.equal(result.runner_pnl, 10);
  assert.equal(result.unrealized_pnl, 15);
  assert.equal(result.pnl_pct, 7.5);
  assert.equal(valueOpenPosition({ ...position, side: 'short' }, 90).unrealized_pnl, 15);
});

test('zero book value has no percentage rather than infinity', () => {
  assert.equal(valueOpenPosition({ ...position, position_value: 0 }, 110).pnl_pct, null);
});


test('lot rounding cannot silently close a position with unaccounted residual inventory', () => {
  assert.match(exitConfirmationError(parseOrderReceipt(receipt, 2), 2.1)!, /remaining inventory/);
  assert.equal(exitConfirmationError(parseOrderReceipt(receipt, 2), 2 + Number.EPSILON), null);
});


test('overlapping exits share one durable claim and submit exactly one exchange order', async () => {
  let durableMarker: string | null = null;
  let submissions = 0;
  const run = (claimToken: string) => runClaimedExit({
    quantity: 2, claimToken,
    claim: async () => {
      if (durableMarker !== null) return false;
      durableMarker = claimToken;
      return true;
    },
    submit: async () => { submissions++; return parseOrderReceipt(receipt, 2); },
  });
  const results = await Promise.all([run('claim-A'), run('claim-B')]);
  assert.equal(submissions, 1);
  assert.equal(results.filter(result => result.error === null).length, 1);
  assert.equal(results.find(result => result.error !== null)?.skipFailureWrite, true);
  assert.equal(durableMarker, 'claim-A');
});

test('failed claim persistence never submits and never clears someone else’s claim', async () => {
  let submitted = false;
  const result = await runClaimedExit({
    quantity: 2, claimToken: 'claim',
    claim: async () => { throw new Error('database down'); },
    submit: async () => { submitted = true; return parseOrderReceipt(receipt, 2); },
  });
  assert.equal(submitted, false);
  assert.equal(result.skipFailureWrite, true);
  assert.match(result.error!, /database down/);
});

test('unknown exchange outcome retains claim ownership and blocks later automatic submission', async () => {
  const result = await runClaimedExit({
    quantity: 2, claimToken: 'durable-claim', claim: async () => true,
    submit: async () => { throw new Error('connection lost after sending'); },
  });
  assert.equal(result.claimToken, 'durable-claim');
  assert.match(result.error!, /^Reconciliation required:/);
  assert.equal(liveExitBlockReason({ binance_order_id: '123', execution_error: result.error }), result.error);
});

test('definitive rejected submission retains ownership for safe failure persistence', async () => {
  const result = await runClaimedExit({
    quantity: 2, claimToken: 'durable-claim', claim: async () => true,
    submit: async () => ({ orderId: null, error: 'Order failed (400): insufficient balance' }),
  });
  assert.equal(result.claimToken, 'durable-claim');
  assert.match(result.error!, /insufficient balance/);
  assert.equal(liveExitBlockReason({ binance_order_id: '123', execution_error: result.error }), null);
});


const attemptA = '11111111-1111-4111-8111-111111111111';
const attemptB = '22222222-2222-4222-8222-222222222222';

test('stable entry and compensation client IDs are distinct and within Binance length limit', () => {
  assert.equal(entryClientOrderId(attemptA), entryClientOrderId(attemptA));
  assert.notEqual(entryClientOrderId(attemptA), entryClientOrderId(attemptA, true));
  assert.equal(entryClientOrderId(attemptA).length, 33);
  assert.throws(() => entryClientOrderId('bad-id'));
});

test('ambiguous exchange errors never release an entry claim as a rejection', () => {
  assert.equal(isDefinitiveOrderRejection(400, '{"code":-2010,"msg":"insufficient balance"}'), true);
  for (const [status, body] of [[400, '{"code":-1007}'], [503, '{"code":-2010}'], [408, '{}'], [400, 'gateway failed']] as const) {
    assert.equal(isDefinitiveOrderRejection(status, body), false);
  }
});

test('concurrent entry attempts submit once and hold the successful fill until tracking', async () => {
  let claimed = false;
  let submitted = 0;
  let settled = 0;
  const run = (attemptId: string) => runClaimedEntry({
    attemptId,
    claim: async () => { if (claimed) return false; claimed = true; return true; },
    submit: async (clientId) => { submitted++; assert.equal(clientId, entryClientOrderId(attemptA)); return parseOrderReceipt(receipt, 2); },
    settleFailure: async () => { settled++; },
  });
  const results = await Promise.all([run(attemptA), run(attemptB)]);
  assert.equal(submitted, 1);
  assert.equal(settled, 0);
  assert.equal(claimed, true);
  assert.equal(results[0].error, null);
  assert.match(results[1].error!, /already pending/);
});

test('entry network ambiguity is persisted as unresolved, not released', async () => {
  let state = 'claimed';
  const result = await runClaimedEntry({
    attemptId: attemptA, claim: async () => true,
    submit: async () => { throw new Error('response lost'); },
    settleFailure: async (next) => { state = next; },
  });
  assert.equal(state, 'reconciliation_required');
  assert.match(result.error!, /response lost/);
});

test('definitive rejected entry is explicitly released for a later attempt', async () => {
  let state = 'claimed';
  await runClaimedEntry({
    attemptId: attemptA, claim: async () => true,
    submit: async () => ({ orderId: null, error: 'Order rejected', definitiveRejection: true }),
    settleFailure: async (next) => { state = next; },
  });
  assert.equal(state, 'rejected');
});

test('entry cannot submit when its durable claim database is unavailable', async () => {
  let submitted = false;
  const result = await runClaimedEntry({
    attemptId: attemptA,
    claim: async () => { throw new Error('database unavailable'); },
    submit: async () => { submitted = true; return parseOrderReceipt(receipt, 2); },
    settleFailure: async () => { throw new Error('should not settle'); },
  });
  assert.equal(submitted, false);
  assert.match(result.error!, /claim failed/);
});


test('filled entry with an unobserved database row always requires reconciliation', () => {
  for (const failure of ['database timeout', 'constraint violation', 'row not found', 'lookup unavailable']) {
    const result = recoverEntryTracking(null, failure);
    assert.equal(result.tradeId, null);
    assert.match(result.error!, /^Reconciliation required:/);
    assert.match(result.error!, new RegExp(failure));
  }
  assert.deepEqual(recoverEntryTracking('confirmed-row', 'response lost'), { tradeId: 'confirmed-row', error: null });
});
