/*
# Allow guest NFT purchases (no account required)

1. Summary
   Speeds up the path to payment: buyers no longer must create an account
   before checkout. Stripe Checkout collects the buyer's email itself, so the
   sale can be recorded without a signed-in user.

2. Modified Tables
   - `nft_sales`: `buyer_user_id` becomes nullable. Existing rows are
     unaffected. Signed-in buyers still get their user id recorded; guests
     get NULL and are identified only by the masked email shown in the
     public feed.

3. Security
   - Row level security unchanged: buyers still only read their own rows
     (`buyer_user_id = auth.uid()` matches NULL rows for nobody, which is
     correct — guests have no account to read from).
   - The Stripe webhook keeps writing via service_role, which bypasses RLS.
*/

ALTER TABLE nft_sales ALTER COLUMN buyer_user_id DROP NOT NULL;
