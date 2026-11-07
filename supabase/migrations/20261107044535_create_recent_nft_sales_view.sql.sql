/*
# Public recent NFT sales feed

1. Summary
   Creates a small public "activity feed" for the NFT sales page: the most
   recent completed card purchases, with buyer privacy protected.

2. New Objects
   - View `recent_nft_sales`: the 12 most recent completed sales joined to
     `nft_collection` for the card name and artwork. Exposes only:
     card name, faction id, rarity, purchase time, and a masked buyer email
     (e.g. `j***@gmail.com`). No user ids, no raw emails, no payment ids.

3. Security
   - The view runs as its caller (`security_invoker = true`) so it can never
     silently bypass row level security.
   - `anon` and `authenticated` get SELECT so the public NFT page can show it;
     RLS on `nft_sales` still limits underlying rows to the caller's own rows,
     which is why the aggregation is done in a SECURITY DEFINER helper.
*/
