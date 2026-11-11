import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@23.0.0';
import { integrationIdentifier, validateCheckoutRedirect } from './policy.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: { name: 'Bolt Integration', version: '1.0.0' },
  apiVersion: '2026-09-30.endive',
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function corsResponse(body: string | object | null, status = 200) {
  if (status === 204) return new Response(null, { status, headers: corsHeaders });
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return corsResponse({}, 204);
    if (req.method !== 'POST') return corsResponse({ error: 'Method not allowed' }, 405);

    const { tier, action, success_url: requestedSuccessUrl, cancel_url: requestedCancelUrl } = await req.json();
    let success_url: string;
    let cancel_url: string;
    try {
      const allowed = Deno.env.get('CHECKOUT_ALLOWED_URLS') ?? 'https://gxrey59-dev.github.io/Bolt.new/';
      success_url = validateCheckoutRedirect(requestedSuccessUrl, allowed);
      cancel_url = validateCheckoutRedirect(requestedCancelUrl, allowed);
    } catch {
      return corsResponse({ error: 'Checkout return URL is not configured for this app.' }, 400);
    }
    if (tier !== 'pro') return corsResponse({ error: 'Unknown tier' }, 400);
    if (typeof success_url !== 'string' || typeof cancel_url !== 'string') {
      return corsResponse({ error: 'Missing success_url or cancel_url' }, 400);
    }

    // Subscriptions require a signed-in account so access can be tied to it.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return corsResponse({ error: 'Sign in to subscribe' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return corsResponse({ error: 'Sign in to subscribe' }, 401);
    }
    const userId = userData.user.id;

    const PRICES: Record<string, { name: string; amount: number; interval: 'month' | 'year' }> = {
      pro: { name: 'Signals Pro — monthly', amount: 2900, interval: 'month' },
    };
    const tierConfig = PRICES[tier];
    if (!tierConfig) return corsResponse({ error: 'Unknown tier' }, 400);

    // Reuse the customer created by NFT checkout when one exists.
    let customerId: string | null = null;
    const { data: existing, error: customerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (customerError) throw new Error('Billing profile unavailable.');
    if (existing?.customer_id) {
      customerId = existing.customer_id;
    } else {
      if (action === 'portal') return corsResponse({ error: 'No billing profile exists yet.' }, 409);
      // Keep creation parameters stable across tabs and retries. Checkout
      // collects email; mutable profile data must not change this idempotency key.
      const customer = await stripe.customers.create({ metadata: { userId } }, {
        idempotencyKey: `signals-customer-v1-${userId}`,
      });
      const { error: insertError } = await supabase.from('stripe_customers').insert({
        user_id: userId,
        customer_id: customer.id,
      });
      if (insertError) {
        // Another request may have saved this same idempotent customer. Never
        // delete it: a concurrent request may already be creating Checkout.
        const { data: winner, error: winnerError } = await supabase.from('stripe_customers')
          .select('customer_id').eq('user_id', userId).is('deleted_at', null).maybeSingle();
        if (winnerError || !winner?.customer_id) throw new Error('Could not save billing profile.');
        customerId = winner.customer_id;
      } else {
        customerId = customer.id;
      }
    }
    if (!customerId) return corsResponse({ error: 'Could not resolve billing profile' }, 500);

    if (action === 'portal') {
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: cancel_url });
      return corsResponse({ url: portal.url });
    }
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (subscriptions.has_more) throw new Error('Billing history requires review before starting another subscription.');
    if (subscriptions.data.some(s => ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(s.status))) {
      return corsResponse({ error: 'An existing subscription needs attention. Use Manage billing to view it.' }, 409);
    }

    const requestedParams: Stripe.Checkout.SessionCreateParams = {
      integration_identifier: integrationIdentifier(),
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: tierConfig.amount,
            recurring: { interval: tierConfig.interval },
            product_data: { name: tierConfig.name },
          },
        },
      ],
      mode: 'subscription',
      expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
      success_url,
      cancel_url,
      metadata: { tier, user_id: userId },
      subscription_data: { metadata: { tier, user_id: userId } },
    };
    const { data: attempt, error: claimError } = await supabase.rpc('claim_subscription_checkout', {
      p_user_id: userId, p_tier: tier, p_checkout_params: requestedParams,
    });
    if (claimError || !attempt) throw new Error('Checkout coordination is unavailable.');
    const params = attempt.checkout_params as Stripe.Checkout.SessionCreateParams;
    if (params.customer !== customerId || params.mode !== 'subscription') {
      throw new Error('Pending billing profile changed; review the existing checkout.');
    }
    // Stripe retains idempotency keys for at least 24h. Stop automatic replay
    // before that boundary; never create a second session after an ambiguous
    // request merely because our local clock says its claim is old.
    if (!attempt.stripe_session_id && Date.now() - Date.parse(attempt.created_at) > 20 * 60 * 60 * 1000) {
      return corsResponse({ error: 'A previous checkout needs billing review before another can be started.' }, 409);
    }
    const session = attempt.stripe_session_id
      ? await stripe.checkout.sessions.retrieve(attempt.stripe_session_id)
      : await stripe.checkout.sessions.create(params, { idempotencyKey: `signals-checkout-${attempt.attempt_id}` });
    const { data: attached, error: attachError } = await supabase.rpc('attach_subscription_checkout', {
      p_user_id: userId, p_tier: tier, p_attempt_id: attempt.attempt_id, p_session_id: session.id,
    });
    if (attachError || !attached) throw new Error('Checkout could not be recorded. Retry to recover the same session.');
    if (session.status === 'open' && session.url) return corsResponse({ url: session.url });

    let canRelease = session.status === 'expired';
    if (session.status === 'complete' && session.subscription) {
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      canRelease = ['canceled', 'incomplete_expired'].includes(subscription.status);
    }
    if (canRelease) {
      const { error: releaseError } = await supabase.rpc('release_subscription_checkout', {
        p_user_id: userId, p_tier: tier, p_attempt_id: attempt.attempt_id, p_session_id: session.id,
      });
      if (releaseError) throw releaseError;
      return corsResponse({ error: 'Your previous checkout has ended. Retry to start a new checkout.' }, 409);
    }
    return corsResponse({ error: 'Your existing checkout is processing. Manage billing or wait for confirmation.' }, 409);
  } catch (error: unknown) {
    console.error('Subscription checkout error:', error);
    return corsResponse({ error: 'Could not start checkout. Please try again.' }, 500);
  }
});
