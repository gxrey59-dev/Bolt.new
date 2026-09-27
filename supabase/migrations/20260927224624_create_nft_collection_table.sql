/*
# Create NFT collection table

1. New Tables
- `nft_collection` — stores Wu-Tang themed NFT trading cards, one per faction
  - `id` (uuid, primary key)
  - `faction_id` (text, references faction identifier like 'rza', 'gza', etc.)
  - `name` (text, NFT name e.g. "The Abbot")
  - `member` (text, Wu-Tang member name)
  - `persona` (text, description of the card's theme)
  - `image_url` (text, path to the generated artwork)
  - `rarity` (text: common, rare, legendary, mythic)
  - `power` (int, combat power score)
  - `minted_at` (timestamp)
  - `mint_price` (numeric, price in USDT to mint)
  - `total_supply` (int, max supply)
  - `minted_count` (int, how many minted so far)
  - `traits` (jsonb, additional traits like trading stats, color, etc.)
2. Security
- Enable RLS on `nft_collection`.
- Allow anon + authenticated to read (public collection showcase).
- Allow anon + authenticated to update minted_count (minting).
*/

CREATE TABLE IF NOT EXISTS nft_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id text NOT NULL UNIQUE,
  name text NOT NULL,
  member text NOT NULL,
  persona text NOT NULL,
  image_url text NOT NULL,
  rarity text NOT NULL DEFAULT 'rare',
  power int NOT NULL DEFAULT 100,
  mint_price numeric NOT NULL DEFAULT 0,
  total_supply int NOT NULL DEFAULT 100,
  minted_count int NOT NULL DEFAULT 0,
  traits jsonb DEFAULT '{}'::jsonb,
  minted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE nft_collection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_nfts" ON nft_collection;
CREATE POLICY "anon_read_nfts" ON nft_collection FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_nfts" ON nft_collection;
CREATE POLICY "anon_update_nfts" ON nft_collection FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_insert_nfts" ON nft_collection;
CREATE POLICY "anon_insert_nfts" ON nft_collection FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Seed the 9 faction NFTs
INSERT INTO nft_collection (faction_id, name, member, persona, image_url, rarity, power, mint_price, total_supply, minted_count, traits)
VALUES
  ('rza', 'The Abbot', 'RZA', 'Supreme Architect — orchestrates all faction strategies', '/nft-rza.webp', 'mythic', 999, 0.5, 100, 0, '{"color": "amber", "element": "gold", "ability": "Orchestrate", "signature_move": "36 Chambers"}'),
  ('gza', 'The Genius', 'GZA', 'Lyrical Scientist — precision analytics and data-driven trades', '/nft-gza.webp', 'legendary', 850, 0.3, 200, 0, '{"color": "blue", "element": "crystal", "ability": "Analyze", "signatureMove": "Liquid Swords"}'),
  ('suicideboys', '$uicideboy$', '$crim & Ruby', 'Predator faction — high-risk, high-magnitude strikes', '/nft-suicideboys.webp', 'legendary', 800, 0.3, 200, 0, '{"color": "slate", "element": "shadow", "ability": "Predator", "signatureMove": "Kill Yourself"}'),
  ('methodman', 'Meth Lab', 'Method Man', 'Street Chemist — volatile short-term plays', '/nft-methodman.webp', 'rare', 700, 0.15, 500, 0, '{"color": "red", "element": "lightning", "ability": "Catalyst", "signatureMove": "Tical"}'),
  ('ghostface', 'Tony Starks', 'Ghostface Killah', 'Supreme Clientele — premium token selection', '/nft-ghostface.webp', 'legendary', 820, 0.3, 200, 0, '{"color": "pink", "element": "phantom", "ability": "Starks", "signatureMove": "Supreme Clientele"}'),
  ('raekwon', 'The Chef', 'Raekwon', 'Cuban Linx strategist — calculated mid-range plays', '/nft-raekwon.webp', 'rare', 720, 0.15, 500, 0, '{"color": "green", "element": "ice", "ability": "Calculate", "signatureMove": "Cuban Linx"}'),
  ('inspectah', 'Inspectah Deck', 'Inspectah Deck', 'Hedge specialist — sentiment-inverted defense plays', '/nft-inspectah.webp', 'rare', 680, 0.15, 500, 0, '{"color": "purple", "element": "shield", "ability": "Hedge", "signatureMove": "Uncontrolled Substance"}'),
  ('ugod', 'U-God', 'U-God', 'Golden Arms — cross-chain bridge arbitrage', '/nft-ugod.webp', 'rare', 650, 0.15, 500, 0, '{"color": "cyan", "element": "bridge", "ability": "Bridge", "signatureMove": "Golden Arms"}'),
  ('mastakilla', 'Masta Killa', 'Masta Killa', 'No Said Date — patient long-hold accumulation', '/nft-mastakilla.webp', 'rare', 670, 0.15, 500, 0, '{"color": "lime", "element": "time", "ability": "Patience", "signatureMove": "No Said Date"}')
ON CONFLICT (faction_id) DO NOTHING;
