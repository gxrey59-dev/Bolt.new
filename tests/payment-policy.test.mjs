import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCheckoutRedirect, isPaidCheckout, objectId, isChargeableUsdAmount, isDefinitiveStripeRejection } from '../supabase/functions/stripe-checkout/policy.ts';

test('return URLs stay on approved deployment path including GitHub Pages subpath', () => {
  const allowed = 'https://gxrey59-dev.github.io/Bolt.new/,https://app.example.com/';
  assert.equal(validateCheckoutRedirect('https://gxrey59-dev.github.io/Bolt.new/?nft=success#nft', allowed), 'https://gxrey59-dev.github.io/Bolt.new/?nft=success#nft');
  for (const url of ['https://evil.example/', 'https://app.example.com.evil.test/', 'https://gxrey59-dev.github.io/other-project/', 'javascript:alert(1)', 'https://user:pass@app.example.com/']) {
    assert.throws(() => validateCheckoutRedirect(url, allowed));
  }
  assert.throws(() => validateCheckoutRedirect('https://app.example.com/', ''));
});

test('fulfillment waits for paid confirmation, including delayed payment methods', () => {
  assert.equal(isPaidCheckout('checkout.session.completed', {mode:'payment',payment_status:'unpaid'}), false);
  assert.equal(isPaidCheckout('checkout.session.async_payment_succeeded', {mode:'payment',payment_status:'paid'}), true);
  assert.equal(isPaidCheckout('checkout.session.completed', {mode:'subscription',payment_status:'paid'}), false);
  assert.equal(isPaidCheckout('checkout.session.async_payment_failed', {mode:'payment',payment_status:'unpaid'}), false);
});

test('expanded Stripe IDs and missing references are handled explicitly', () => {
  assert.equal(objectId({id:'cus_123'}), 'cus_123');
  assert.equal(objectId('pi_123'), 'pi_123');
  assert.equal(objectId(null), null);
  assert.equal(objectId({}), null);
});

test('prices under the Stripe USD minimum are never offered for checkout', () => {
  for (const cents of [15, 30, 49, 0, -50, 50.5, NaN, '50']) assert.equal(isChargeableUsdAmount(cents), false, String(cents));
  for (const cents of [50, 2900]) assert.equal(isChargeableUsdAmount(cents), true);
});

test('only a definitive Stripe refusal releases reserved stock', () => {
  assert.equal(isDefinitiveStripeRejection({ type: 'StripeInvalidRequestError', statusCode: 400 }), true);
  for (const error of [
    { type: 'StripeConnectionError' },
    { type: 'StripeAPIError', statusCode: 500 },
    { type: 'StripeRateLimitError', statusCode: 429 },
    { type: 'StripeInvalidRequestError', statusCode: 409 },
    { type: 'StripeInvalidRequestError' },
    new Error('timeout'), null, undefined,
  ]) assert.equal(isDefinitiveStripeRejection(error), false, JSON.stringify(error));
});
