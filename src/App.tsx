import { lazy, Suspense, useState, useCallback } from 'react';
import { LayoutDashboard, Monitor, Table, Settings, Radio, Gem, Network, Crown, Flame } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { TabId, Faction, Signal, Sweep, CircuitBreaker, Sentiment, AuditEntry } from '@/lib/types';
import Header from '@/components/Header';

const FactionGrid = lazy(() => import('@/components/FactionGrid'));
const SignalFeed = lazy(() => import('@/components/SignalFeed'));
const AuditFeed = lazy(() => import('@/components/AuditFeed'));
const DashboardView = lazy(() => import('@/components/DashboardView'));
const SentimentOverride = lazy(() => import('@/components/SentimentOverride'));
const TableView = lazy(() => import('@/components/TableView'));
const CREAMSweepPanel = lazy(() => import('@/components/CREAMSweepPanel'));
const RevenueSweepPanel = lazy(() => import('@/components/RevenueSweepPanel'));
const BinanceFeedPanel = lazy(() => import('@/components/BinanceFeedPanel'));
const CircuitBreakerPanel = lazy(() => import('@/components/CircuitBreakerPanel'));
const LiveTradingDashboard = lazy(() => import('@/components/LiveTradingDashboard'));
const NFTCollection = lazy(() => import('@/components/NFTCollection'));
const DeFiSwarmPanel = lazy(() => import('@/components/DeFiSwarmPanel'));
const RevenueCommandCenter = lazy(() => import('@/components/RevenueCommandCenter'));
const RevenueSprintDashboard = lazy(() => import('@/components/RevenueSprintDashboard'));

const DATABASE_TABS = new Set<TabId>(['command', 'dashboard', 'table', 'operations']);
const HAS_DATABASE_ACCESS = import.meta.env.VITE_SUPABASE_ANON_KEY !== 'public-edge-functions-only';

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
  const [tab, setTab] = useState<TabId>('swarm');
  const [factions, setFactions] = useState<Faction[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const fetchAll = useCallback(async () => {
    if (!HAS_DATABASE_ACCESS || !DATABASE_TABS.has(tab)) return;
    const { supabase } = await import('@/lib/supabase');
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
  }, [tab]);

  useVisibilityPolling(fetchAll, 10_000, HAS_DATABASE_ACCESS && DATABASE_TABS.has(tab));

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
        <Suspense fallback={<div className="py-24 text-center text-sm text-zinc-500">Loading workspace…</div>}>
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
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CREAMSweepPanel sweeps={sweeps} />
                <RevenueSweepPanel />
              </div>
            </>
          )}

          {tab === 'operations' && (
            <>
              <BinanceFeedPanel />
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
        </Suspense>
      </main>

      <footer className="border-t border-zinc-800/50 bg-zinc-950 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 text-[11px] text-zinc-600">
          <span>Smart refresh: visible tabs only</span>
          <span>Exchange data and on-chain monitoring</span>
        </div>
      </footer>
    </div>
  );
}
