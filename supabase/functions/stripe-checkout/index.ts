import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Bolt Integration',
    version: '1.0.0',
  },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function corsResponse(body: string | object | null, status = 200) {
  if (status === 204) {
    return new Response(null, { status, headers: corsHeaders });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }

    if (req.method !== 'POST') {
      return corsResponse({ error: 'Method not allowed' }, 405);
    }

    const { nft_id, success_url, cancel_url } = await req.json();

    if (typeof nft_id !== 'string' || !nft_id) {
      return corsResponse({ error: 'Missing required parameter nft_id' }, 400);
    }
    if (typeof success_url !== 'string' || typeof cancel_url !== 'string') {
      return corsResponse({ error: 'Missing required parameter success_url or cancel_url' }, 400);
    }

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser(token);

    if (getUserError || !user) {
      return corsResponse({ error: 'Sign in to buy NFTs' }, 401);
    }

    // Price and availability come from the server's own table, never the client.
    const { data: nft, error: nftError } = await supabase
      .from('nft_collection')
      .select('id, name, member, persona, mint_price, total_supply, minted_count')
      .eq('id', nft_id)
      .maybeSingle();

    if (nftError || !nft) {
      return corsResponse({ error: 'NFT not found' }, 404);
    }

    if (nft.minted_count >= nft.total_supply) {
      return corsResponse({ error: 'Sold out' }, 409);
    }

    const mintPrice = Number(nft.mint_price);
    if (!Number.isFinite(mintPrice) || mintPrice <= 0) {
      return corsResponse({ error: 'NFT has no valid mint price' }, 500);
    }

    const { data: customer, error: getCustomerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer information from the database', getCustomerError);
      return corsResponse({ error: 'Failed to fetch customer information' }, 500);
    }

    let customerId;

    if (!customer || !customer.customer_id) {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });

      console.log(`Created new Stripe customer ${newCustomer.id} for user ${user.id}`);

      const { error: createCustomerError } = await supabase.from('stripe_customers').insert({
        user_id: user.id,
        customer_id: newCustomer.id,
      });

      if (createCustomerError) {
        console.error('Failed to save customer information in the database', createCustomerError);
        try {
          await stripe.customers.del(newCustomer.id);
        } catch (deleteError) {
          console.error('Failed to clean up after customer mapping error:', deleteError);
        }
        return corsResponse({ error: 'Failed to create customer mapping' }, 500);
      }

      customerId = newCustomer.id;
    } else {
      customerId = customer.customer_id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${nft.name} — ${nft.member}`,
              description: nft.persona?.slice(0, 300) ?? undefined,
              metadata: { nft_id: nft.id },
            },
            unit_amount: Math.round(mintPrice * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url,
      cancel_url,
      metadata: {
        nft_id: nft.id,
        buyer_user_id: user.id,
        buyer_email: user.email ?? '',
      },
    });

    const { error: saleInsertError } = await supabase.from('nft_sales').insert({
      nft_id: nft.id,
      buyer_user_id: user.id,
      buyer_email: user.email ?? '',
      stripe_checkout_session_id: session.id,
      amount_total: Math.round(mintPrice * 100),
      currency: 'usd',
      status: 'pending',
    });

    if (saleInsertError) {
      console.error('Failed to record pending sale', saleInsertError);
    }

    console.log(`Created NFT checkout session ${session.id} for customer ${customerId}`);

    return corsResponse({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error(`Checkout error: ${error.message}`);
    return corsResponse({ error: 'Could not start checkout. Please try again.' }, 500);
  }
});
