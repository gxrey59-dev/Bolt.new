import { useState, useEffect, useCallback } from 'react';
import { Gem, Sparkles, Flame, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FACTIONS } from '@/lib/constants';

interface NFTCard {
  id: string;
  faction_id: string;
  name: string;
  member: string;
  persona: string;
  image_url: string;
  rarity: string;
  power: number;
  mint_price: number;
  total_supply: number;
  minted_count: number;
  traits: Record<string, string>;
  minted_at: string;
}

const RARITY_STYLES: Record<string, { border: string; glow: string; label: string; text: string }> = {
  mythic: { border: 'border-amber-500/50', glow: 'shadow-[0_0_30px_-5px_rgba(245,158,11,0.4)]', label: 'MYTHIC', text: 'text-amber-400' },
  legendary: { border: 'border-purple-500/50', glow: 'shadow-[0_0_25px_-5px_rgba(168,85,247,0.35)]', label: 'LEGENDARY', text: 'text-purple-400' },
  rare: { border: 'border-blue-500/40', glow: 'shadow-[0_0_20px_-5px_rgba(59,130,246,0.25)]', label: 'RARE', text: 'text-blue-400' },
};

const FACTION_COLORS: Record<string, string> = {
  amber: '#f59e0b', blue: '#3b82f6', slate: '#94a3b8', red: '#ef4444',
  pink: '#ec4899', green: '#10b981', purple: '#a855f7', cyan: '#06b6d4', lime: '#84cc16',
};

export default function NFTCollection() {
  const [nfts, setNfts] = useState<NFTCard[]>([]);
  const [minting, setMinting] = useState<string | null>(null);
  const [mintedIds, setMintedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchNFTs = useCallback(async () => {
    const { data } = await supabase.from('nft_collection').select('*').order('power', { ascending: false });
    setNfts((data ?? []) as NFTCard[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchNFTs(); }, [fetchNFTs]);

  async function handleMint(nft: NFTCard) {
    setMinting(nft.id);
    const newCount = nft.minted_count + 1;
    const { error } = await supabase.from('nft_collection')
      .update({ minted_count: newCount, minted_at: new Date().toISOString() })
      .eq('id', nft.id);
    if (!error) {
      setMintedIds(prev => new Set(prev).add(nft.id));
      setNfts(prev => prev.map(n => n.id === nft.id ? { ...n, minted_count: newCount } : n));
    }
    setTimeout(() => setMinting(null), 600);
  }

  const totalMinted = nfts.reduce((s, n) => s + n.minted_count, 0);
  const totalSupply = nfts.reduce((s, n) => s + n.total_supply, 0);
  const totalRevenue = nfts.reduce((s, n) => s + n.mint_price * n.minted_count, 0);

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gem className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-bold text-zinc-100">Wu-Tang Financial Weapon NFTs</h2>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-400">
          <Sparkles className="h-3 w-3" />
          {totalMinted} / {totalSupply} MINTED
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-400">
          ${totalRevenue.toFixed(2)} REVENUE
        </span>
      </div>

      {/* NFT Grid */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nfts.map(nft => {
            const rarityStyle = RARITY_STYLES[nft.rarity] ?? RARITY_STYLES.rare;
            const factionMeta = FACTIONS.find(f => f.id === nft.faction_id);
            const accentColor = FACTION_COLORS[factionMeta?.color ?? 'blue'];
            const isMinted = mintedIds.has(nft.id);
            const soldOut = nft.minted_count >= nft.total_supply;
            const mintProgress = (nft.minted_count / nft.total_supply) * 100;

            return (
              <div
                key={nft.id}
                className={`group relative overflow-hidden rounded-2xl border ${rarityStyle.border} bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 p-5 transition-all hover:scale-[1.02] ${rarityStyle.glow}`}
              >
                {/* Rarity badge */}
                <div className="absolute right-3 top-3 z-10">
                  <span className={`rounded-full bg-zinc-950/80 px-2.5 py-1 text-[9px] font-bold tracking-wider ${rarityStyle.text}`}>
                    {rarityStyle.label}
                  </span>
                </div>

                {/* Artwork */}
                <div className="relative mx-auto mb-4 h-44 w-44">
                  <div
                    className="absolute inset-0 rounded-full blur-2xl opacity-30 transition-opacity group-hover:opacity-50"
                    style={{ backgroundColor: accentColor }}
                  />
                  <img
                    src={nft.image_url}
                    alt={nft.name}
                    className="relative h-full w-full object-contain drop-shadow-2xl"
                    style={{ filter: `drop-shadow(0 0 12px ${accentColor}40)` }}
                  />
                </div>

                {/* Name + Member */}
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-base font-bold text-zinc-100">{nft.name}</h3>
                  <span className="text-[10px] text-zinc-600">{nft.member}</span>
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">{nft.persona}</p>

                {/* Stats */}
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-zinc-950/60 p-2 text-center">
                    <p className="text-[8px] uppercase tracking-wider text-zinc-600">Power</p>
                    <p className="font-mono text-sm font-bold" style={{ color: accentColor }}>{nft.power}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-950/60 p-2 text-center">
                    <p className="text-[8px] uppercase tracking-wider text-zinc-600">Ability</p>
                    <p className="text-[10px] font-semibold text-zinc-300">{nft.traits.ability ?? '—'}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-950/60 p-2 text-center">
                    <p className="text-[8px] uppercase tracking-wider text-zinc-600">Element</p>
                    <p className="text-[10px] font-semibold capitalize" style={{ color: accentColor }}>{nft.traits.element ?? '—'}</p>
                  </div>
                </div>

                {/* Mint progress */}
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-[9px] text-zinc-600">
                    <span>{nft.minted_count} / {nft.total_supply} minted</span>
                    <span>{mintProgress.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${mintProgress}%`, backgroundColor: accentColor }}
                    />
                  </div>
                </div>

                {/* Mint button */}
                <button
                  onClick={() => handleMint(nft)}
                  disabled={minting === nft.id || soldOut}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${
                    soldOut
                      ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
                      : isMinted
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                  }`}
                >
                  {minting === nft.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isMinted ? (
                    <><Check className="h-3.5 w-3.5" /> Minted!</>
                  ) : soldOut ? (
                    'Sold Out'
                  ) : (
                    <><Flame className="h-3.5 w-3.5" /> Mint for ${nft.mint_price}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
