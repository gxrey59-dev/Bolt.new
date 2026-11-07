/*
# Public recent NFT sales feed

1. Summary
   Adds a public "recent purchases" activity feed for the NFT sales page.
   Shows the newest completed card purchases with buyer privacy protected:
   buyer emails are masked inside the database before anything leaves it, and
   no user ids or payment ids are ever exposed.

2. New Objects
   - Function `public.get_recent_nft_sales()` (SECURITY DEFINER): returns the
     12 most recent completed sales joined with `nft_collection` for the card
     name, member and artwork. Only exposes: card name, member, faction id,
     rarity, image url, masked buyer email, and purchase time.
   - SECURITY DEFINER is needed because `nft_sales` row level security only
     lets each buyer read their own rows; this read-only helper reads on
     behalf of the public feed and limits output to masked, non-sensitive
     columns.

3. Security
   - EXECUTE revoked from PUBLIC, granted only to `anon` and `authenticated`.
   - Read-only: no inserts or updates possible through this function.
*/

CREATE OR REPLACE FUNCTION public.get_recent_nft_sales()
RETURNS TABLE (
  card_name text,
  member text,
  faction_id text,
  rarity text,
  image_url text,
  buyer_masked text,
  purchased_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.name::text,
    c.member::text,
    c.faction_id::text,
    c.rarity::text,
    c.image_url::text,
    CASE
      WHEN position('@' in s.buyer_email) > 1 THEN
        left(s.buyer_email, 1) || '***' || substring(s.buyer_email from position('@' in s.buyer_email))
      ELSE 'a buyer'
    END,
    s.created_at
  FROM nft_sales s
  JOIN nft_collection c ON c.id = s.nft_id
  WHERE s.status = 'completed'
  ORDER BY s.created_at DESC
  LIMIT 12;
$$;

REVOKE EXECUTE ON FUNCTION public.get_recent_nft_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recent_nft_sales() TO anon, authenticated;
