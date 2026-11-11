/*
# Revenue reliability: safe NFT checkout reservations and billing review log

1. Changes to existing tables
- `paper_trades`: adds `accounting_verified`, `inventory_verified` (both default false),
  `execution_error`, `exit_proceeds` if missing. No existing rows are changed.

2. New tables
- `billing_review_events`: records refund/dispute notices from the payment provider
  for manual review. Server-only.

3. New server-only functions
- `reserve_nft_checkout`: locks a collection item and reserves one unit before payment.
- `fulfill_nft_checkout`: confirms a paid reservation exactly once, checking item,
  price and currency match, then records the order.
- `record_billing_review_event`: stores a refund/dispute notice once.

4. Security
- All functions and the new table are revoked from browser roles and granted only to
  the server role. RLS enabled on the new table with no policies (deny-by-default).
- No customer rows are deleted, repriced, charged, or refunded.
*/

ALTER TABLE public.paper_trades
  ADD COLUMN IF NOT EXISTS accounting_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_error text,
  ADD COLUMN IF NOT EXISTS exit_proceeds numeric;

GRANT SELECT, UPDATE ON public.nft_collection TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.nft_sales TO service_role;
GRANT SELECT, INSERT ON public.stripe_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stripe_orders_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_nft_checkout(p_nft_id uuid, p_buyer_user_id uuid, p_buyer_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE card public.nft_collection%ROWTYPE; sale public.nft_sales%ROWTYPE; reserved bigint;
BEGIN
  SELECT * INTO card FROM public.nft_collection WHERE id = p_nft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection item not found'; END IF;
  IF card.mint_price IS NULL OR card.mint_price <= 0 THEN RAISE EXCEPTION 'Invalid collection price'; END IF;
  SELECT count(*) INTO reserved FROM public.nft_sales WHERE nft_id=p_nft_id AND status='pending';
  IF card.minted_count + reserved >= card.total_supply THEN RAISE EXCEPTION 'Sold out'; END IF;
  INSERT INTO public.nft_sales(nft_id,buyer_user_id,buyer_email,stripe_checkout_session_id,amount_total,currency,status)
  VALUES(p_nft_id,p_buyer_user_id,coalesce(p_buyer_email,''),'reservation_'||gen_random_uuid()::text,round(card.mint_price*100),'usd','pending')
  RETURNING * INTO sale;
  RETURN jsonb_build_object('id',sale.id,'amount_total',sale.amount_total);
END $$;
REVOKE ALL ON FUNCTION public.reserve_nft_checkout(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nft_checkout(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fulfill_nft_checkout(
  p_session_id text,p_reservation_id uuid,p_nft_id uuid,p_payment_intent_id text,p_customer_id text,
  p_amount_total bigint,p_amount_subtotal bigint,p_currency text,p_buyer_email text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE sale public.nft_sales%ROWTYPE;
BEGIN
  SELECT * INTO sale FROM public.nft_sales
  WHERE stripe_checkout_session_id=p_session_id OR (p_reservation_id IS NOT NULL AND id=p_reservation_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment has no matching reservation'; END IF;
  IF sale.nft_id<>p_nft_id OR sale.currency<>p_currency OR sale.amount_total<>p_amount_total THEN
    RAISE EXCEPTION 'Payment does not match reserved item, currency, or price';
  END IF;
  IF sale.stripe_checkout_session_id<>p_session_id AND sale.stripe_checkout_session_id NOT LIKE 'reservation_%' THEN
    RAISE EXCEPTION 'Reservation is already linked to another payment';
  END IF;
  IF sale.status='completed' THEN RETURN false; END IF;
  IF sale.status<>'pending' THEN RAISE EXCEPTION 'Payment reservation is not pending; review required'; END IF;
  IF p_payment_intent_id IS NULL OR p_customer_id IS NULL OR p_amount_subtotal IS NULL THEN
    RAISE EXCEPTION 'Payment references are required';
  END IF;
  UPDATE public.nft_collection SET minted_count=minted_count+1 WHERE id=p_nft_id AND minted_count<total_supply;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paid item exceeds supply; review and refund required'; END IF;
  UPDATE public.nft_sales SET status='completed',stripe_checkout_session_id=p_session_id,
    stripe_payment_intent_id=p_payment_intent_id,buyer_email=coalesce(nullif(p_buyer_email,''),buyer_email),updated_at=now()
    WHERE id=sale.id;
  INSERT INTO public.stripe_orders(checkout_session_id,payment_intent_id,customer_id,amount_subtotal,amount_total,currency,payment_status,status)
    SELECT p_session_id,p_payment_intent_id,p_customer_id,p_amount_subtotal,p_amount_total,p_currency,'paid','completed'
    WHERE NOT EXISTS (SELECT 1 FROM public.stripe_orders WHERE checkout_session_id=p_session_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fulfill_nft_checkout(text,uuid,uuid,text,text,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_nft_checkout(text,uuid,uuid,text,text,bigint,bigint,text,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_review_events (
  event_id text PRIMARY KEY,event_type text NOT NULL,charge_id text NOT NULL,customer_id text,
  stripe_created bigint NOT NULL,received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_review_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.billing_review_events TO service_role;
CREATE OR REPLACE FUNCTION public.record_billing_review_event(p_event_id text,p_event_type text,p_charge_id text,p_customer_id text,p_created bigint)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
  INSERT INTO public.billing_review_events(event_id,event_type,charge_id,customer_id,stripe_created)
  VALUES(p_event_id,p_event_type,p_charge_id,p_customer_id,p_created) ON CONFLICT(event_id) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.record_billing_review_event(text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_billing_review_event(text,text,text,text,bigint) TO service_role;
