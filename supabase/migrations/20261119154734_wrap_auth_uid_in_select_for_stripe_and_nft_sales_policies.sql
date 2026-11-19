-- Wrap auth.uid() in a scalar subquery so Postgres evaluates it once per
-- statement instead of once per row (Supabase documented remediation for the
-- auth_rls_initplan linter). Semantics are unchanged.
-- nft_sales.buyer_user_id is nullable; the row only passes when the uid matches,
-- so a NULL buyer id never leaks. is_app_operator() calls inside owner policies
-- were left as-is because those tables' public read policies make them cold paths.

DROP POLICY IF EXISTS "Users can view their own customer data" ON public.stripe_customers;
CREATE POLICY "Users can view their own customer data" ON public.stripe_customers FOR SELECT
  TO authenticated
  USING ((user_id = (select auth.uid())) AND (deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can view their own order data" ON public.stripe_orders;
CREATE POLICY "Users can view their own order data" ON public.stripe_orders FOR SELECT
  TO authenticated
  USING ((customer_id IN (SELECT stripe_customers.customer_id FROM stripe_customers WHERE ((stripe_customers.user_id = (select auth.uid())) AND (stripe_customers.deleted_at IS NULL)))) AND (deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can view their own subscription data" ON public.stripe_subscriptions;
CREATE POLICY "Users can view their own subscription data" ON public.stripe_subscriptions FOR SELECT
  TO authenticated
  USING ((customer_id IN (SELECT stripe_customers.customer_id FROM stripe_customers WHERE ((stripe_customers.user_id = (select auth.uid())) AND (stripe_customers.deleted_at IS NULL)))) AND (deleted_at IS NULL));

DROP POLICY IF EXISTS "buyers_read_own_sales" ON public.nft_sales;
CREATE POLICY "buyers_read_own_sales" ON public.nft_sales FOR SELECT
  TO authenticated
  USING (buyer_user_id = (select auth.uid()));
