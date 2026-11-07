import { useState, useEffect, useCallback } from 'react';
import { Gem, Sparkles, Flame, Check, Loader2, Share2, Download, X, TrendingUp, Copy, ExternalLink, ShieldCheck, Lock } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { FACTIONS } from '@/lib/constants';
import { signInWithEmail, signUpWithEmail } from '@/lib/operatorAuth';

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

const RARITY_STYLES: Record<string, { border: string; glow: string; label: string; text: string; bg: string }> = {
  mythic: { border: 'border-amber-500/50', glow: 'shadow-[0_0_30px_-5px_rgba(245,158,11,0.4)]', label: 'MYTHIC', text: 'text-amber-400', bg: 'from-amber-500/10' },
  legendary: { border: 'border-purple-500/50', glow: 'shadow-[0_0_25px_-5px_rgba(168,85,247,0.35)]', label: 'LEGENDARY', text: 'text-purple-400', bg: 'from-purple-500/10' },
  rare: { border: 'border-blue-500/40', glow: 'shadow-[0_0_20px_-5px_rgba(59,130,246,0.25)]', label: 'RARE', text: 'text-blue-400', bg: 'from-blue-500/10' },
};

const FACTION_COLORS: Record<string, string> = {
  amber: '#f59e0b', blue: '#3b82f6', slate: '#94a3b8', red: '#ef4444',
  pink: '#ec4899', green: '#10b981', purple: '#a855f7', cyan: '#06b6d4', lime: '#84cc16',
};

export default function NFTCollection() {
  const [nfts, setNfts] = useState<NFTCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<NFTCard | null>(null);
  const [copied, setCopied] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState('');
  const [pendingBuy, setPendingBuy] = useState<string | null>(null);
  const [purchaseComplete, setPurchaseComplete] = useState(false);

  const fetchNFTs = useCallback(async () => {
    setLoading(true);
    if (!hasDatabaseAccess) {
      setLoadError('Collection data requires a Supabase publishable key.');
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.from('nft_collection').select('*').order('power', { ascending: false }).abortSignal(AbortSignal.timeout(10000));
      if (error) throw new Error(error.message);
      setNfts((data ?? []) as NFTCard[]);
      setLoadError('');
    } catch (cause) {
      setNfts([]);
      setLoadError(cause instanceof Error ? cause.message : 'Collection data unavailable.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNFTs(); }, [fetchNFTs]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    if (new URLSearchParams(window.location.search).get('nft') === 'success') {
      setPurchaseComplete(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleBuy(nft: NFTCard) {
    setBuyError('');
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setPendingBuy(nft.id);
      return;
    }
    setBuyingId(nft.id);
    try {
      const origin = `${window.location.origin}${window.location.pathname}`;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          nft_id: nft.id,
          success_url: `${origin}?nft=success`,
          cancel_url: `${origin}#nft`,
        }),
      });
      const body: { url?: string; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) {
        throw new Error(body.error === 'Sold out' ? 'This card just sold out.' : 'Checkout could not start. Please try again.');
      }
      window.location.href = body.url;
    } catch (cause) {
      setBuyError(cause instanceof Error ? cause.message : 'Checkout could not start. Please try again.');
      setBuyingId(null);
    }
  }

  function handleSignedIn() {
    setSignedIn(true);
    const id = pendingBuy;
    setPendingBuy(null);
    const nft = id ? nfts.find(n => n.id === id) : undefined;
    if (nft) void handleBuy(nft);
  }

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    if (navigator.share) {
      navigator.share({ title: 'Wu-Tang Financial Weapon NFTs', url }).catch(() => {});
    }
  }

  function handleShareCard(nft: NFTCard) {
    const url = `${window.location.origin}/#nft`;
    if (navigator.share) {
      navigator.share({
        title: `${nft.name} — ${nft.rarity.toUpperCase()} NFT`,
        text: `${nft.name} (${nft.member}) — Power ${nft.power}. ${nft.persona}`,
        url,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`${url} — ${nft.name} (${nft.member})`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const totalSupply = nfts.reduce((s, n) => s + n.total_supply, 0);
  const mythicCount = nfts.filter(n => n.rarity === 'mythic').length;
  const legendaryCount = nfts.filter(n => n.rarity === 'legendary').length;

  return (
    <section className="space-y-5">
      {purchaseComplete && <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300"><ShieldCheck className="h-4 w-4" /> Payment received — your card is reserved. It may take a few seconds to appear as minted.</p>}
      {buyError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{buyError}</p>}
      {pendingBuy && <BuyerAuthPanel onSignedIn={handleSignedIn} />}
      {loadError && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-300">{loadError}<button onClick={() => void fetchNFTs()} className="ml-3 underline">Retry</button></p>}
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-purple-500/10 blur-3xl" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Gem className="h-6 w-6 text-amber-400" />
              <h2 className="text-xl font-bold text-zinc-100">Wu-Tang Financial Weapon</h2>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">v1</span>
            </div>
            <p className="text-sm text-zinc-400 max-w-lg">
              Faction artwork and collection designs. Buy instantly with a card through Stripe Checkout — payment is secured by Stripe and your card is reserved the moment it clears.
            </p>
            <div className="mt-3 flex items-center gap-4 text-[11px]">
              <span className="flex items-center gap-1 text-amber-400">
                <Sparkles className="h-3 w-3" /> {mythicCount} Mythic
              </span>
              <span className="flex items-center gap-1 text-purple-400">
                <Sparkles className="h-3 w-3" /> {legendaryCount} Legendary
              </span>
              <span className="flex items-center gap-1 text-zinc-500">
                <TrendingUp className="h-3 w-3" /> {nfts.length - mythicCount - legendaryCount} Rare
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2.5 text-xs font-bold text-zinc-200 transition-all hover:bg-zinc-700"
            >
              {copied ? <><Check className="h-3.5 w-3.5 text-emerald-400" /> Copied!</> : <><Share2 className="h-3.5 w-3.5" /> Share Collection</>}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Total Minted</p>
          <p className="font-mono text-lg font-bold tabular-nums text-zinc-100">{nfts.reduce((s, n) => s + n.minted_count, 0)} / {totalSupply} minted</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Mint Revenue</p>
          <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">${nfts.reduce((s, n) => s + Number(n.mint_price) * n.minted_count, 0).toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Unique Cards</p>
          <p className="font-mono text-lg font-bold tabular-nums text-zinc-100">{nfts.length}</p>
        </div>
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
            const mintProgress = nft.total_supply > 0 ? (nft.minted_count / nft.total_supply) * 100 : 0;
            const soldOut = nft.minted_count >= nft.total_supply;

            return (
              <div
                key={nft.id}
                className={`group relative overflow-hidden rounded-2xl border ${rarityStyle.border} bg-gradient-to-br ${rarityStyle.bg} from-zinc-900/90 to-zinc-950/90 p-5 transition-all hover:scale-[1.02] ${rarityStyle.glow}`}
              >
                {/* Rarity badge */}
                <div className="absolute right-3 top-3 z-10">
                  <span className={`rounded-full bg-zinc-950/80 px-2.5 py-1 text-[9px] font-bold tracking-wider ${rarityStyle.text}`}>
                    {rarityStyle.label}
                  </span>
                </div>

                {/* Artwork */}
                <div className="relative mx-auto mb-4 h-44 w-44 cursor-pointer" onClick={() => setSelected(nft)}>
                  <div
                    className="absolute inset-0 rounded-full blur-2xl opacity-30 transition-opacity group-hover:opacity-50"
                    style={{ backgroundColor: accentColor }}
                  />
                  <img
                    src={nft.image_url}
                    alt={nft.name}
                    className="relative h-full w-full object-contain drop-shadow-2xl transition-transform group-hover:scale-110"
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
                    <span>{Math.round(mintProgress)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${mintProgress}%`, backgroundColor: accentColor }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleBuy(nft)}
                    disabled={soldOut || buyingId === nft.id}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      soldOut
                        ? 'bg-zinc-800 text-zinc-500'
                        : 'bg-amber-500 text-black hover:bg-amber-400'
                    }`}
                  >
                    {buyingId === nft.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
                    {soldOut ? 'Sold Out' : buyingId === nft.id ? 'Opening checkout…' : `Buy — ${Number(nft.mint_price).toFixed(2)}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (() => {
        const rarityStyle = RARITY_STYLES[selected.rarity] ?? RARITY_STYLES.rare;
        const factionMeta = FACTIONS.find(f => f.id === selected.faction_id);
        const accentColor = FACTION_COLORS[factionMeta?.color ?? 'blue'];
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => setSelected(null)}
          >
            <div
              className={`relative max-w-md w-full rounded-2xl border ${rarityStyle.border} bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 ${rarityStyle.glow}`}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setSelected(null)}
                className="absolute right-3 top-3 rounded-lg bg-zinc-800/80 p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-all"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Large artwork */}
              <div className="relative mx-auto mb-5 h-56 w-56">
                <div
                  className="absolute inset-0 rounded-full blur-3xl opacity-40"
                  style={{ backgroundColor: accentColor }}
                />
                <img
                  src={selected.image_url}
                  alt={selected.name}
                  className="relative h-full w-full object-contain drop-shadow-2xl"
                  style={{ filter: `drop-shadow(0 0 20px ${accentColor}50)` }}
                />
              </div>

              {/* Rarity + Name */}
              <div className="mb-3 text-center">
                <span className={`rounded-full bg-zinc-950/80 px-3 py-1 text-[10px] font-bold tracking-wider ${rarityStyle.text}`}>
                  {rarityStyle.label}
                </span>
                <h3 className="mt-2 text-xl font-bold text-zinc-100">{selected.name}</h3>
                <p className="text-xs text-zinc-500">{selected.member}</p>
              </div>

              <p className="mb-4 text-center text-sm text-zinc-400">{selected.persona}</p>

              {/* Full stats */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-zinc-950/60 p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">Power Score</p>
                  <p className="font-mono text-xl font-bold" style={{ color: accentColor }}>{selected.power}</p>
                </div>
                <div className="rounded-xl bg-zinc-950/60 p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">Mint Price</p>
                  <p className="font-mono text-xl font-bold text-emerald-400">${selected.mint_price}</p>
                </div>
                <div className="rounded-xl bg-zinc-950/60 p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">Ability</p>
                  <p className="text-sm font-semibold text-zinc-300">{selected.traits.ability ?? '—'}</p>
                </div>
                <div className="rounded-xl bg-zinc-950/60 p-3 text-center">
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">Signature Move</p>
                  <p className="text-sm font-semibold text-zinc-300">{selected.traits.signatureMove ?? '—'}</p>
                </div>
              </div>

              {/* Supply */}
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-600">
                  <span>{selected.minted_count} / {selected.total_supply} minted</span>
                  <span>{selected.total_supply > 0 ? Math.round((selected.minted_count / selected.total_supply) * 100) : 0}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-zinc-800">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${selected.total_supply > 0 ? (selected.minted_count / selected.total_supply) * 100 : 0}%`, backgroundColor: accentColor }}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleBuy(selected)}
                  disabled={selected.minted_count >= selected.total_supply || buyingId === selected.id}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected.minted_count >= selected.total_supply
                      ? 'bg-zinc-800 text-zinc-500'
                      : 'bg-amber-500 text-black hover:bg-amber-400'
                  }`}
                >
                  {buyingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
                  {selected.minted_count >= selected.total_supply ? 'Sold Out' : buyingId === selected.id ? 'Opening checkout…' : `Buy — ${Number(selected.mint_price).toFixed(2)}`}
                </button>
                <a
                  href={selected.image_url}
                  download={`wutang-nft-${selected.faction_id}.webp`}
                  className="flex items-center justify-center rounded-xl bg-zinc-800 px-4 py-3 text-zinc-400 transition-all hover:bg-zinc-700 hover:text-zinc-200"
                  title="Download artwork"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => handleShareCard(selected)}
                  className="flex items-center justify-center rounded-xl bg-zinc-800 px-4 py-3 text-zinc-400 transition-all hover:bg-zinc-700 hover:text-zinc-200"
                  title="Share this card"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>

              {/* Share link */}
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-zinc-950/60 p-2.5">
                <Copy className="h-3 w-3 flex-shrink-0 text-zinc-600" />
                <input
                  readOnly
                  aria-label="NFT collection share link"
                  value={`${window.location.origin}/#nft`}
                  className="flex-1 bg-transparent text-[11px] text-zinc-500"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-zinc-600" />
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

function BuyerAuthPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
      }
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-amber-500/30 bg-zinc-900/60 p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Create a free account to buy</h3>
          <p className="text-xs text-zinc-500">Your purchase and card are tied to this account.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-950 p-1">
          {(['sign-in', 'sign-up'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => { setMode(option); setError(''); }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === option ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {option === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>
        <input
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60"
          required
        />
        <input
          type="password"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          placeholder="Password (6+ characters)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60"
          minLength={6}
          required
        />
        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'sign-in' ? 'Sign in & continue' : 'Create account & continue'}
        </button>
      </form>
    </div>
  );
}
