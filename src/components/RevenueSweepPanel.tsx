import { useState, useEffect } from 'react';
import { Send, Zap, AlertTriangle, CheckCircle2, XCircle, Radio, RefreshCw, Coins } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Collection, CollectionRoute } from '@/lib/types';

export default function RevenueSweepPanel() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);
  const [sending, setSending] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [nonUsdtBalances, setNonUsdtBalances] = useState<{ coin: string; free: string }[]>([]);
  const [confirmStep, setConfirmStep] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const [withdrawalRes, routesRes] = await Promise.all([
        supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(15),
        supabase.from('withdrawal_routes').select('*').order('created_at', { ascending: false }).limit(20),
      ]);
      if (cancelled) return;
      setCollections(withdrawalRes.data ?? []);
      setRoutes(routesRes.data ?? []);
    }

    async function fetchBalances() {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/binance-withdraw/balance`, {
          headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
        });
        const data = await res.json();
        if (data.ok && data.nonZeroBalances) {
          const usdt = data.nonZeroBalances.find((b: { coin: string }) => b.coin === 'USDT');
          setUsdtBalance(usdt ? parseFloat(usdt.free) : 0);
          setNonUsdtBalances(data.nonZeroBalances.filter((b: { coin: string }) => b.coin !== 'USDT'));
        }
      } catch { /* ignore */ }
    }

    fetchData();
    fetchBalances();
    const id = setInterval(() => { fetchData(); fetchBalances(); }, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function executeCollection() {
    setCollecting(true);
    setLastResult(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/binance-withdraw`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        const coinsSold = result.coinsSold?.map((c: { coin: string }) => c.coin).join(', ') ?? 'none';
        setLastResult({
          success: true,
          message: `Collected +$${(result.usdtGained ?? 0).toFixed(2)} USDT. Sold: ${coinsSold}. Balance: $${(result.usdtAfter ?? 0).toFixed(2)}`,
        });
      } else {
        setLastResult({ success: false, message: result.error ?? 'Collection failed' });
      }
      setConfirmStep(false);
      // Refresh data
      const [wData, rData] = await Promise.all([
        supabase.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(15),
        supabase.from('withdrawal_routes').select('*').order('created_at', { ascending: false }).limit(20),
      ]);
      setCollections(wData.data ?? []);
      setRoutes(rData.data ?? []);
      // Refresh balances
      const balRes = await fetch(`${supabaseUrl}/functions/v1/binance-withdraw/balance`, {
        headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      });
      const balData = await balRes.json();
      if (balData.ok && balData.nonZeroBalances) {
        const usdt = balData.nonZeroBalances.find((b: { coin: string }) => b.coin === 'USDT');
        setUsdtBalance(usdt ? parseFloat(usdt.free) : 0);
        setNonUsdtBalances(balData.nonZeroBalances.filter((b: { coin: string }) => b.coin !== 'USDT'));
      }
    } finally {
      setCollecting(false);
    }
  }

  const statusIcon: Record<string, JSX.Element> = {
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    failed: <XCircle className="h-3.5 w-3.5 text-red-400" />,
    pending: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
    confirmed: <RefreshCw className="h-3.5 w-3.5 text-blue-400" />,
  };

  const completedCount = collections.filter(w => w.status === 'completed').length;
  const totalCollected = collections.filter(w => w.status === 'completed').reduce((sum, w) => sum + Number(w.amount), 0);
  const sellableCoins = nonUsdtBalances.filter(b => parseFloat(b.free) > 0);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Send className="h-5 w-5 text-cyan-400" />
        <h2 className="text-base font-semibold text-zinc-200">Revenue Collection</h2>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-semibold text-cyan-400">
          <Coins className="h-3 w-3" />
          Spot Sell
        </span>
      </div>

      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-[11px] uppercase text-zinc-600">USDT Balance</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-400">
              {usdtBalance !== null ? `$${usdtBalance.toFixed(2)}` : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-[11px] uppercase text-zinc-600">Sellable Coins</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-amber-400">
              {sellableCoins.length}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-[11px] uppercase text-zinc-600">Collections</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-200">{completedCount}</p>
          </div>
        </div>

        {/* Non-USDT Balances */}
        {sellableCoins.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Non-USDT Holdings (Sellable)</h3>
            <div className="space-y-1">
              {sellableCoins.map(b => (
                <div key={b.coin} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/40">
                  <span className="font-mono font-semibold text-zinc-300">{b.coin}</span>
                  <span className="font-mono tabular-nums text-amber-400">{parseFloat(b.free).toFixed(6)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spot Sell Control */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-300">Collect Revenue</h3>
          </div>
          <p className="mb-3 text-[11px] text-zinc-600">
            Sells all non-USDT coin holdings at market price on Binance.US, converting them to USDT.
            This realizes trading gains using your spot trading permission — no withdrawal authorization needed.
          </p>

          {lastResult && (
            <div className={`mb-3 rounded-lg border p-3 text-xs ${
              lastResult.success
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                : 'border-red-500/30 bg-red-500/5 text-red-400'
            }`}>
              <div className="flex items-center gap-2">
                {lastResult.success
                  ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                <span>{lastResult.message}</span>
              </div>
            </div>
          )}

          {!confirmStep ? (
            <button
              onClick={() => setConfirmStep(true)}
              disabled={sellableCoins.length === 0}
              className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
            >
              {sellableCoins.length === 0
                ? 'No Non-USDT Holdings to Sell'
                : `Sell ${sellableCoins.length} Coin${sellableCoins.length > 1 ? 's' : ''} to USDT`}
            </button>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="mb-2 text-xs text-amber-400">
                Confirm: Market sell all non-USDT holdings ({sellableCoins.map(c => c.coin).join(', ')}) to USDT?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={executeCollection}
                  disabled={collecting}
                  className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  {collecting ? 'Selling...' : 'Confirm Sell'}
                </button>
                <button
                  onClick={() => setConfirmStep(false)}
                  disabled={collecting}
                  className="flex-1 rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* AI Routing Decisions */}
        {routes.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-zinc-300">Collection Log</h3>
              <span className="ml-auto text-[10px] text-zinc-600">Last {routes.length}</span>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {routes.map(r => {
                const w = collections.find(wd => wd.id === r.withdrawal_id);
                return (
                  <div key={r.id} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        r.strategy === 'spot-sell'
                          ? 'bg-cyan-500/15 text-cyan-400'
                          : r.strategy === 'simulate'
                          ? 'bg-zinc-700/40 text-zinc-400'
                          : 'bg-emerald-500/15 text-emerald-400'
                      }`}>
                        {r.strategy}
                      </span>
                      {r.success
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                      <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-600">
                        {r.latency_ms}ms
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed mb-1.5">
                      {r.ai_reasoning}
                    </p>
                    {w && (
                      <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                        <span className="font-mono tabular-nums">
                          {Number(w.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} {w.token}
                        </span>
                        {w.tx_hash && (
                          <span className="truncate font-mono" title={w.tx_hash}>
                            ID:{w.tx_hash.slice(0, 12)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* History */}
        {collections.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Collection History</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {collections.map(w => {
                const isSpot = w.tx_hash?.startsWith('SPOT-');
                const isSim = w.tx_hash?.startsWith('SIM-');
                return (
                  <div key={w.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/40">
                    {statusIcon[w.status] ?? statusIcon.pending}
                    <span className="font-mono tabular-nums text-zinc-300">
                      {Number(w.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} {w.token}
                    </span>
                    {isSpot && (
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">SPOT</span>
                    )}
                    {isSim && (
                      <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-500">SIM</span>
                    )}
                    {w.status === 'failed' && w.error_message && (
                      <span className="truncate text-[10px] text-red-500" title={w.error_message}>
                        {w.error_message.slice(0, 40)}
                      </span>
                    )}
                    <span className="ml-auto font-mono tabular-nums text-zinc-600">
                      {new Date(w.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
