import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@23.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { isPaidCheckout, objectId } from './policy.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-09-30.endive' });
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  try {
    // Acknowledge only after persistence. Returning 200 before a background task
    // finishes prevents Stripe from retrying a lost order or entitlement update.
    await handleEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error('Stripe event persistence failed', event.id, error);
    return Response.json({ error: 'Event could not be persisted; retry required.' }, { status: 500 });
  }
});

async function handleEvent(event: Stripe.Event) {
  if (event.type.startsWith('checkout.session.')) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isPaidCheckout(event.type, session)) {
      if (!session.metadata?.nft_id) return;
      const customerId = objectId(session.customer);
      const paymentIntentId = objectId(session.payment_intent);
      if (!customerId || !paymentIntentId || session.amount_total === null || session.amount_subtotal === null || !session.currency) {
        throw new Error('Paid checkout is missing required payment references.');
      }
      // Sale transition, stock increment and order insertion share one database
      // transaction. Duplicated/concurrent webhook deliveries are no-ops.
      const { error } = await supabase.rpc('fulfill_nft_checkout', {
        p_session_id: session.id,
        p_reservation_id: session.metadata.reservation_id || null,
        p_nft_id: session.metadata.nft_id,
        p_payment_intent_id: paymentIntentId,
        p_customer_id: customerId,
        p_amount_total: session.amount_total,
        p_amount_subtotal: session.amount_subtotal,
        p_currency: session.currency,
        p_buyer_email: session.customer_details?.email ?? '',
      });
      if (error) throw error;
      return;
    }
    if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
      let query = supabase.from('nft_sales').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('status', 'pending');
      query = session.metadata?.reservation_id
        ? query.eq('id', session.metadata.reservation_id)
        : query.eq('stripe_checkout_session_id', session.id);
      const { error } = await query;
      if (error) throw error;
      return;
    }
    if (session.mode === 'subscription' && event.type === 'checkout.session.completed') {
      const customerId = objectId(session.customer);
      if (customerId) await syncCustomerFromStripe(customerId);
    }
    return;
  }
  if (event.type.startsWith('customer.subscription.') || ['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'].includes(event.type)) {
    const object = event.data.object as unknown as { customer?: unknown };
    const customerId = objectId(object.customer);
    if (customerId) await syncCustomerFromStripe(customerId);
    return;
  }
  if (['charge.dispute.created', 'charge.refunded', 'radar.early_fraud_warning.created'].includes(event.type)) {
    const object = event.data.object as unknown as { id: string; charge?: unknown; customer?: unknown };
    const chargeId = event.type === 'charge.refunded' ? object.id : objectId(object.charge);
    if (!chargeId) throw new Error('Risk event has no charge reference.');
    const charge = await stripe.charges.retrieve(chargeId);
    // Preserve a review task for the operator; refunds/disputes do not silently
    // change subscription contracts or trigger additional charges.
    const { error } = await supabase.rpc('record_billing_review_event', {
      p_event_id: event.id, p_event_type: event.type, p_charge_id: charge.id,
      p_customer_id: objectId(charge.customer), p_created: event.created,
    });
    if (error) throw error;
  }
}

async function syncCustomerFromStripe(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId, limit: 100, status: 'all', expand: ['data.default_payment_method'],
  });
  // Prioritize an entitled contract over a more recent canceled attempt.
  const eligible = subscriptions.data.filter(s => s.metadata.tier === 'pro');
  const subscription = eligible.find(s => ['active', 'trialing', 'past_due'].includes(s.status)) ?? eligible[0];
  if (!subscription) {
    const { error } = await supabase.from('stripe_subscriptions').upsert({
      customer_id: customerId, status: 'not_started', subscription_id: null, price_id: null,
      current_period_start: null, current_period_end: null, cancel_at_period_end: false,
      payment_method_brand: null, payment_method_last4: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'customer_id' });
    if (error) throw error;
    return;
  }
  const item = subscription.items.data[0];
  if (!item) throw new Error('Subscription has no price item.');
  const paymentMethod = typeof subscription.default_payment_method === 'object' ? subscription.default_payment_method : null;
  const { error } = await supabase.from('stripe_subscriptions').upsert({
    customer_id: customerId, subscription_id: subscription.id, price_id: item.price.id,
    current_period_start: item.current_period_start, current_period_end: item.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
    payment_method_brand: paymentMethod?.card?.brand ?? null,
    payment_method_last4: paymentMethod?.card?.last4 ?? null,
    status: subscription.status, updated_at: new Date().toISOString(),
  }, { onConflict: 'customer_id' });
  if (error) throw error;
}
