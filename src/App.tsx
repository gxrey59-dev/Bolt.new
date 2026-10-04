import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Network, Wallet, Gem, DollarSign } from 'lucide-react';

type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string };
const tabs = [
  { id: 'markets', label: 'Market Data', icon: Activity },
  { id: 'account', label: 'Exchange Account', icon: Wallet },
  { id: 'swarm', label: 'DeFi Swarms', icon: Network },
  { id: 'nft', label: 'NFT Armory', icon: Gem },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
] as const;
const pairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT'];
const unavailable = {
  account: { title: 'Exchange account verification required', body: 'Verified balances and earnings are unavailable. The existing trade records must be reconciled against exchange fills, fees and current holdings before they can be reported as actual performance.', needs: 'Required: owner authentication, a protected balance endpoint and exchange order reconciliation.' },
  swarm: { title: 'DeFi Swarms — Not connected', body: 'No live DeFi wallet, protocol positions or execution worker is connected. There are no verified swarm balances, yields or agent actions to display.', needs: 'Required: a wallet connection, supported protocol integration, transaction confirmation tracking and an execution worker.' },
  nft: { title: 'NFT Armory — Not connected', body: 'No deployed mint contract or confirmed on-chain sales are connected. Mint counts and NFT revenue are unavailable.', needs: 'Required: a deployed collection contract, wallet connection and confirmed transaction indexing.' },
  revenue: { title: 'Verified revenue unavailable', body: 'Revenue will appear only after confirmed exchange fills, on-chain receipts or settled payments are connected. No projections or seeded earnings are included.', needs: 'Required: reconciled transaction records with fees and source identifiers.' },
};

export default function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('swarm');
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (tab !== 'markets') return;
    let active = true;
    let current: AbortController | null = null;
    async function load() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      setLoading(true);
      setError('');
      setTickers([]);
      setUpdatedAt(null);
      try {
        const url = new URL('https://api.binance.us/api/v3/ticker/24hr');
        url.searchParams.set('symbols', JSON.stringify(pairs));
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Binance.US returned HTTP ' + response.status);
        const data: unknown = await response.json();
        if (!Array.isArray(data) || data.length !== pairs.length || new Set(data.map(row => row.symbol)).size !== pairs.length || data.some(row => !pairs.includes(row.symbol) || !Number.isFinite(Number(row.lastPrice)) || Number(row.lastPrice) <= 0 || !Number.isFinite(Number(row.priceChangePercent)))) throw new Error('The exchange returned incomplete or invalid market data.');
        if (active) { setTickers(data as Ticker[]); setUpdatedAt(new Date().toISOString()); }
      } catch (cause) {
        if (active) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'The market data request timed out or was interrupted.');
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => { active = false; clearInterval(timer); current?.abort(); };
  }, [tab, refresh]);
  const status = tab === 'markets' ? null : unavailable[tab];
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-5">
        <h1 className="text-xl font-bold">Wu-Tang Financial Weapon</h1>
        <p className="mt-1 text-sm text-zinc-400">Verified data only</p>
      </header>
      <nav aria-label="Main navigation" className="flex flex-wrap gap-2 border-b border-zinc-800 p-4">
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={'rounded-lg px-4 py-2 text-sm ' + (tab === item.id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-900')}><Icon className="mr-2 inline h-4 w-4" />{item.label}</button>; })}
      </nav>
      <main className="mx-auto max-w-6xl p-6">
        {status ? <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-xl font-semibold">{status.title}</h2>
          <p className="mt-4 max-w-3xl text-zinc-300">{status.body}</p>
          <p className="mt-4 max-w-3xl text-sm text-zinc-400">{status.needs}</p>
        </section> : <section>
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Binance.US spot prices</h2><button disabled={loading} onClick={() => setRefresh(value => value + 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className="mr-2 inline h-4 w-4" />Refresh</button></div>
          <p className="mt-2 text-sm text-zinc-400">Public exchange market data. These prices do not represent account balances or earnings.</p>
          {loading && <p role="status" className="mt-6">Loading exchange data…</p>}
          {error && <p role="alert" className="mt-6 rounded-lg border border-amber-700 p-4 text-amber-200">Market data unavailable: {error} No replacement values are shown.</p>}
          {!loading && !error && tickers.length > 0 && <><p className="my-4 text-xs text-zinc-400">Received: {updatedAt} · refreshes every 30 seconds</p><table className="w-full text-left"><thead><tr className="border-b border-zinc-700"><th className="py-3">Pair</th><th>Price (USDT)</th><th>24h change</th></tr></thead><tbody>{tickers.map(row => <tr key={row.symbol} className="border-b border-zinc-800"><td className="py-4">{row.symbol}</td><td>{Number(row.lastPrice).toLocaleString('en-US', { maximumFractionDigits: 8 })}</td><td>{Number(row.priceChangePercent).toFixed(2)}%</td></tr>)}</tbody></table></>}
        </section>}
      </main>
      <footer className="mt-8 border-t border-zinc-800 p-6 text-xs text-zinc-500">This interface does not initiate trades, mint tokens or move funds. Existing server-side jobs require a separate review.</footer>
    </div>
  );
}
import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Monitor, Table, Settings, Radio, Gem, Network, Crown, Flame } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { runStrategyScan, updateFactionStats } from '@/lib/engine';
import type { TabId, Faction, Signal, Sweep, CircuitBreaker, Sentiment, AuditEntry } from '@/lib/types';
import Header from '@/components/Header';
import FactionGrid from '@/components/FactionGrid';
import SignalFeed from '@/components/SignalFeed';
import AuditFeed from '@/components/AuditFeed';
import DashboardView from '@/components/DashboardView';
import SentimentOverride from '@/components/SentimentOverride';
import TableView from '@/components/TableView';
import CREAMSweepPanel from '@/components/CREAMSweepPanel';
import RevenueSweepPanel from '@/components/RevenueSweepPanel';
import BinanceFeedPanel from '@/components/BinanceFeedPanel';
import CircuitBreakerPanel from '@/components/CircuitBreakerPanel';
import PaperTradingPanel from '@/components/PaperTradingPanel';
import BacktestPanel from '@/components/BacktestPanel';
import LiveTradingDashboard from '@/components/LiveTradingDashboard';
import NFTCollection from '@/components/NFTCollection';
import DeFiSwarmPanel from '@/components/DeFiSwarmPanel';
import RevenueCommandCenter from '@/components/RevenueCommandCenter';
import RevenueSprintDashboard from '@/components/RevenueSprintDashboard';

const TABS: { id: TabId; label: string; icon: typeof Monitor }[] = [
  { id: 'sprint', label: '24h Sprint', icon: Flame },
  { id: 'live', label: 'Live Terminal', icon: Radio },
  { id: 'command', label: 'Command Center', icon: Monitor },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'table', label: 'Table View', icon: Table },
  { id: 'operations', label: 'Operations', icon: Settings },
  { id: 'nft', label: 'NFT Armory', icon: Gem },
  { id: 'swarm', label: 'DeFi Swarms', icon: Network },
  { id: 'revenue', label: 'Revenue', icon: Crown },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('live');
  const [factions, setFactions] = useState<Faction[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const fetchAll = useCallback(async () => {
    const [fRes, sRes, swRes, bRes, seRes, aRes] = await Promise.all([
      supabase.from('factions').select('*').order('name'),
      supabase.from('signals').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('sweeps').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('circuit_breakers').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('sentiment').select('*').eq('active', true).limit(1),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50),
    ]);

    if (fRes.data) setFactions(fRes.data);
    if (sRes.data) setSignals(sRes.data);
    if (swRes.data) setSweeps(swRes.data);
    if (bRes.data) setBreakers(bRes.data);
    setSentiment(seRes.data?.[0] ?? null);
    if (aRes.data) setAudit(aRes.data);
  }, []);

  useEffect(() => {
    fetchAll();
    const pollId = setInterval(fetchAll, 2000);

    const scanId = setInterval(runStrategyScan, 15000);
    const statsId = setInterval(updateFactionStats, 10000);

    runStrategyScan();

    return () => {
      clearInterval(pollId);
      clearInterval(scanId);
      clearInterval(statsId);
    };
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Header factions={factions} sweeps={sweeps} />

      <nav className="sticky top-[73px] z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] gap-1 px-6 py-2">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="space-y-8 animate-fade-in">
          {tab === 'sprint' && (
            <RevenueSprintDashboard />
          )}

          {tab === 'live' && (
            <LiveTradingDashboard />
          )}

          {tab === 'command' && (
            <>
              <FactionGrid factions={factions} />
              <PaperTradingPanel />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SignalFeed signals={signals} />
                <AuditFeed entries={audit} />
              </div>
            </>
          )}

          {tab === 'dashboard' && (
            <>
              <DashboardView factions={factions} />
              <SentimentOverride sentiment={sentiment} />
            </>
          )}

          {tab === 'table' && (
            <>
              <TableView factions={factions} />
              <PaperTradingPanel />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CREAMSweepPanel sweeps={sweeps} />
                <RevenueSweepPanel />
              </div>
            </>
          )}

          {tab === 'operations' && (
            <>
              <BinanceFeedPanel />
              <BacktestPanel />
              <PaperTradingPanel />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CircuitBreakerPanel breakers={breakers} factions={factions} />
                <SentimentOverride sentiment={sentiment} />
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SignalFeed signals={signals} />
                <AuditFeed entries={audit} />
              </div>
            </>
          )}

          {tab === 'nft' && (
            <NFTCollection />
          )}

          {tab === 'swarm' && (
            <DeFiSwarmPanel />
          )}

          {tab === 'revenue' && (
            <RevenueCommandCenter />
          )}
        </div>
      </main>

      <footer className="border-t border-zinc-800/50 bg-zinc-950 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 text-[11px] text-zinc-600">
          <span>Scan: 15s / Stats: 10s</span>
          <span>Live Binance.US data — real candles, real signals</span>
        </div>
      </footer>
    </div>
  );
}
