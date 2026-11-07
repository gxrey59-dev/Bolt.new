/*
# Add increment_nft_minted_count for webhook oversell guard

1. New Functions
   - `increment_nft_minted_count(p_nft_id uuid) RETURNS void`
     - Increments nft_collection.minted_count by 1 only while minted_count < total_supply.
     - SECURITY DEFINER so the Stripe webhook (service_role) can call it.
2. Security
   - EXECUTE revoked from PUBLIC and anon; granted only to service_role.
3. Notes
   - Called by the stripe-webhook edge function after a completed NFT payment.
     The WHERE clause makes the increment atomic, so concurrent payments cannot
     oversell past total_supply.
*/

CREATE OR REPLACE FUNCTION increment_nft_minted_count(p_nft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE nft_collection
  SET minted_count = minted_count + 1
  WHERE id = p_nft_id
    AND minted_count < total_supply;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NFT % is sold out or does not exist', p_nft_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_nft_minted_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION increment_nft_minted_count(uuid) TO service_role;
