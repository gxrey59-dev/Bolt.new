import { useEffect, useState } from 'react';
import { Crown, Activity, Wallet } from 'lucide-react';
import type { Faction, Sweep } from '@/lib/types';
import { supabase } from '@/lib/supabase';

interface Props { factions: Faction[]; sweeps: Sweep[]; }
export default function Header(_props: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active) return;
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-feed/account`, {
          signal: controller.signal,
          headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        });
        if (!response.ok) throw new Error(`Account connection returned HTTP ${response.status}.`);
        const data = await response.json();
        if (data.error || !Array.isArray(data.balances)) throw new Error(data.error || 'Account response is incomplete.');
        const asset = data.balances.find((item: { asset: string }) => item.asset === 'USDT');
        const value = asset ? Number(asset.free) + Number(asset.locked) : 0;
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid account balance.');
        if (active) { setBalance(value); setError(''); }
      } catch (cause) {
        if (active) { setBalance(null); setError(cause instanceof Error ? cause.message : 'Account connection unavailable.'); }
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(() => void load(), 30000);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timer); controller?.abort(); };
  }, []);
  return <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-6 py-4">
      <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400"><Crown className="h-5 w-5" /></div><div><h1 className="text-lg font-bold tracking-tight text-zinc-100">Wu-Tang Financial Weapon</h1><p className="text-xs text-zinc-500">Command Center</p></div></div>
      <div className="flex flex-wrap items-center gap-4">
        <div title={error || 'Actual free plus locked USDT from Binance.US. Other assets are not included.'} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2"><Wallet className="h-4 w-4 text-amber-400" /><span className="font-mono text-sm font-semibold text-amber-400">{balance === null ? '—' : balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span><span className="text-[10px] text-cyan-400">USDT</span></div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2"><Activity className="h-4 w-4 text-cyan-400" /><span className="text-xs text-zinc-300">{balance === null ? 'Account unavailable' : 'Exchange connected'}</span></div>
        <span className="text-xs text-zinc-500">Worker status unverified</span>
      </div>
    </div>
  </header>;
}
