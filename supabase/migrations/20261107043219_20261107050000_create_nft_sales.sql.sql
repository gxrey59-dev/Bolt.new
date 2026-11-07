/*
# Enable NFT sales via Stripe

1. New Tables
   - `nft_sales`: one row per NFT purchase attempt.
     - `id` (uuid, primary key, default gen_random_uuid())
     - `nft_id` (uuid, references nft_collection.id, not null) — which card was bought
     - `buyer_user_id` (uuid, references auth.users.id, not null, defaults to the signed-in user)
     - `buyer_email` (text, not null) — Stripe customer email at purchase time
     - `stripe_checkout_session_id` (text, not null, unique) — idempotency key for the webhook
     - `stripe_payment_intent_id` (text, nullable)
     - `amount_total` (bigint, not null) — charged amount in cents
     - `currency` (text, not null)
     - `status` (text, not null, default 'pending', check in ('pending','completed','canceled'))
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())
2. Security
   - RLS enabled.
   - Buyers can read only their own sale rows (authenticated, owner-scoped).
   - No client INSERT/UPDATE: only the Stripe webhook (service_role) writes rows.
3. Notes
   - `minted_count` on `nft_collection` is incremented by the webhook after payment
     (guarded by `minted_count < total_supply` to prevent oversell).
*/

CREATE TABLE IF NOT EXISTS nft_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nft_id uuid NOT NULL REFERENCES nft_collection(id),
  buyer_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  buyer_email text NOT NULL,
  stripe_checkout_session_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text,
  amount_total bigint NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nft_sales_nft_id_idx ON nft_sales (nft_id);
CREATE INDEX IF NOT EXISTS nft_sales_buyer_idx ON nft_sales (buyer_user_id);

ALTER TABLE nft_sales ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON nft_sales TO authenticated;
GRANT INSERT, UPDATE ON nft_sales TO service_role;

DROP POLICY IF EXISTS "buyers_read_own_sales" ON nft_sales;
CREATE POLICY "buyers_read_own_sales" ON nft_sales
  FOR SELECT TO authenticated
  USING (buyer_user_id = auth.uid());
