import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: { name: 'Bolt Integration', version: '1.0.0' },
  apiVersion: '2024-06-20',
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

    const { tier, success_url, cancel_url } = await req.json();
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
    const userEmail = userData.user.email ?? '';

    const PRICES: Record<string, { name: string; amount: number; interval: 'month' | 'year' }> = {
      pro: { name: 'Signals Pro — monthly', amount: 2900, interval: 'month' },
    };
    const tierConfig = PRICES[tier];
    if (!tierConfig) return corsResponse({ error: 'Unknown tier' }, 400);

    // Reuse the customer created by NFT checkout when one exists.
    let customerId: string | null = null;
    const { data: existing } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing?.customer_id) {
      customerId = existing.customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail || undefined,
        metadata: { userId },
      });
      const { error: insertError } = await supabase.from('stripe_customers').insert({
        user_id: userId,
        customer_id: customer.id,
      });
      if (insertError) {
        try {
          await stripe.customers.del(customer.id);
        } catch (cleanupError) {
          console.error('Customer cleanup failed:', cleanupError);
        }
        return corsResponse({ error: 'Could not save billing profile' }, 500);
      }
      customerId = customer.id;
    }
    if (!customerId) return corsResponse({ error: 'Could not resolve billing profile' }, 500);

    const session = await stripe.checkout.sessions.create({
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
        // NFT-like one-time line item could go here later.
      ],
      mode: 'subscription',
      success_url,
      cancel_url,
      metadata: { tier, user_id: userId },
      subscription_data: { metadata: { tier, user_id: userId } },
    });

    return corsResponse({ url: session.url });
  } catch (error: unknown) {
    console.error('Subscription checkout error:', error);
    return corsResponse({ error: 'Could not start checkout. Please try again.' }, 500);
  }
});
