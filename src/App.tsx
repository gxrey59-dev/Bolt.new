import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { LayoutDashboard, Monitor, Table, Settings, Radio, Gem, Network, Crown, Flame, Target, BarChart3, ArrowUpFromLine, Activity, Wallet, ArrowLeft, Rss } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { TabId, Faction, Signal, Sweep, CircuitBreaker, Sentiment, AuditEntry } from '@/lib/types';
import Header from '@/components/Header';
import OperatorGate from '@/components/OperatorGate';
import OperatorStatusCard from '@/components/OperatorStatusCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useOperatorSession } from '@/lib/useOperatorSession';
import { signOutOperator } from '@/lib/operatorAuth';

const FactionGrid = lazy(() => import('@/components/FactionGrid'));
const SignalFeed = lazy(() => import('@/components/SignalFeed'));
const AuditFeed = lazy(() => import('@/components/AuditFeed'));
const WithdrawalErrorLog = lazy(() => import('@/components/WithdrawalErrorLog'));
const BinanceKeyStatusBadge = lazy(() => import('@/components/BinanceKeyStatusBadge'));
const WithdrawalStatusBanner = lazy(() => import('@/components/WithdrawalStatusBanner'));
const DashboardView = lazy(() => import('@/components/DashboardView'));
const SecurityStatusBar = lazy(() => import('@/components/SecurityStatusBar'));
const FactionPerformanceDashboard = lazy(() => import('@/components/FactionPerformanceDashboard'));
const SentimentOverride = lazy(() => import('@/components/SentimentOverride'));
const TableView = lazy(() => import('@/components/TableView'));
const CREAMSweepPanel = lazy(() => import('@/components/CREAMSweepPanel'));
const RevenueSweepPanel = lazy(() => import('@/components/RevenueSweepPanel'));
const BinanceFeedPanel = lazy(() => import('@/components/BinanceFeedPanel'));
const CircuitBreakerPanel = lazy(() => import('@/components/CircuitBreakerPanel'));
const LiveTradingDashboard = lazy(() => import('@/components/LiveTradingDashboard'));
const NFTCollection = lazy(() => import('@/components/NFTCollection'));
const DeFiSwarmPanel = lazy(() => import('@/components/DeFiSwarmPanel'));
const SwarmWalletSetup = lazy(() => import('@/components/SwarmWalletSetup'));
const RevenueCommandCenter = lazy(() => import('@/components/RevenueCommandCenter'));
const ProfitHistory = lazy(() => import('@/components/ProfitHistory'));
const RevenueSprintDashboard = lazy(() => import('@/components/RevenueSprintDashboard'));
const BillionRoadmap = lazy(() => import('@/components/BillionRoadmap'));
const WithdrawalPanel = lazy(() => import('@/components/WithdrawalPanel'));
const LiveExecutionDashboard = lazy(() => import('@/components/LiveExecutionDashboard'));

const SignalsPro = lazy(() => import('@/components/SignalsPro'));

const DATABASE_TABS = new Set<TabId>(['command', 'dashboard', 'table', 'operations']);
const DASHBOARD_DATA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-feed/dashboard-data`;

const TABS: { id: TabId; label: string; icon: typeof Monitor }[] = [
  { id: 'sprint', label: '24h Sprint', icon: Flame },
  { id: 'live', label: 'Live Terminal', icon: Radio },
  { id: 'execution', label: 'Live Execution', icon: Activity },
  { id: 'command', label: 'Command Center', icon: Monitor },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'table', label: 'Table View', icon: Table },
  { id: 'operations', label: 'Operations', icon: Settings },
  { id: 'nft', label: 'NFT Armory', icon: Gem },
  { id: 'signals-pro', label: 'Signals Pro', icon: Rss },
  { id: 'swarm', label: 'DeFi Swarms', icon: Network },
  { id: 'swarm-wallet', label: 'Swarm Wallet', icon: Wallet },
  { id: 'revenue', label: 'Revenue', icon: Crown },
  { id: 'withdrawal', label: 'Withdrawal', icon: ArrowUpFromLine },
  { id: 'roadmap', label: 'Roadmap', icon: Target },
];

const NFT_STORE_TAB: TabId = 'nft';

function tabFromHash(): TabId | null {
  const id = window.location.hash.replace(/^#/, '') as TabId;
  return TABS.some(t => t.id === id) ? id : null;
}

export default function App() {
  const [tab, setTab] = useState<TabId>(() => tabFromHash() ?? 'swarm');
  const inStoreMode = tab === NFT_STORE_TAB;

  useEffect(() => {
    const sync = () => {
      const fromHash = tabFromHash();
      if (fromHash) setTab(fromHash);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function switchTab(next: TabId) {
    setTab(next);
    if (window.location.hash !== `#${next}`) {
      window.history.replaceState(null, '', `#${next}`);
    }
  }
  const [factions, setFactions] = useState<Faction[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [dataError, setDataError] = useState('');
  const { status: operatorStatus, email: operatorEmail } = useOperatorSession();

  const fetchAll = useCallback(async () => {
    if (!DATABASE_TABS.has(tab)) return;
    const response = await fetch(DASHBOARD_DATA_URL, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    });
    if (!response.ok) throw new Error(`Dashboard connection returned HTTP ${response.status}.`);
    const data = await response.json() as {
      factions: Faction[]; signals: Signal[]; sweeps: Sweep[];
      breakers: CircuitBreaker[]; sentiment: Sentiment | null; audit: AuditEntry[];
    };
    setFactions(data.factions);
    setSignals(data.signals);
    setSweeps(data.sweeps);
    setBreakers(data.breakers);
    setSentiment(data.sentiment);
    setAudit(data.audit);
    setDataError('');
  }, [tab]);

  const refreshDashboard = useCallback(async () => {
    try {
      await fetchAll();
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Dashboard data is unavailable.');
    }
  }, [fetchAll]);

  useVisibilityPolling(refreshDashboard, 10_000, DATABASE_TABS.has(tab));

  return (
    <div className="relative min-h-screen overflow-x-clip bg-zinc-950">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-grid" />
      <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute right-[8%] top-40 h-[280px] w-[280px] rounded-full bg-emerald-500/5 blur-[100px]" />
      {inStoreMode ? null : <Header factions={factions} sweeps={sweeps} operator={operatorStatus === 'operator'} />}
      {inStoreMode ? null : <Suspense fallback={null}><SecurityStatusBar /></Suspense>}

      {inStoreMode ? null : (
      <nav className="sticky top-[110px] z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 py-2 sm:px-6">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 shadow-inner shadow-black/40 ring-1 ring-zinc-700'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : ''}`} />
                {t.label}
              </button>
            );
          })}
          {(operatorStatus === 'operator' || operatorStatus === 'signed-in') && (
            <button
              onClick={() => { void signOutOperator(); }}
              className="ml-auto flex-shrink-0 rounded-lg px-4 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            >
              Sign out
            </button>
          )}
        </div>
      </nav>
      )}

      <main id="main-content" className="relative mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {dataError && DATABASE_TABS.has(tab) ? (
          <div role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {dataError}
          </div>
        ) : null}
        <Suspense fallback={<div className="py-24 text-center text-sm text-zinc-500">Loading workspace…</div>}>
        <ErrorBoundary key={tab}>
        <div className="space-y-8 animate-rise-in">
          {tab === 'sprint' && (
            <RevenueSprintDashboard />
          )}

          {tab === 'live' && (
            <OperatorGate status={operatorStatus}>
              <LiveTradingDashboard />
            </OperatorGate>
          )}

          {tab === 'execution' && (
            <OperatorGate status={operatorStatus}>
              <LiveExecutionDashboard />
            </OperatorGate>
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
              <OperatorGate status={operatorStatus}>
                <WithdrawalStatusBanner />
              </OperatorGate>
              <DashboardView factions={factions} />
              <SentimentOverride sentiment={sentiment} />
            </>
          )}

          {tab === 'performance' && (
            <FactionPerformanceDashboard factions={factions} />
          )}

          {tab === 'table' && (
            <>
              <TableView factions={factions} />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CREAMSweepPanel sweeps={sweeps} />
                <OperatorGate status={operatorStatus}>
                  <RevenueSweepPanel />
                </OperatorGate>
              </div>
            </>
          )}

          {tab === 'operations' && (
            <OperatorGate status={operatorStatus}>
              <OperatorStatusCard email={operatorEmail} />
              <BinanceFeedPanel />
              <BinanceKeyStatusBadge />
              <WithdrawalErrorLog />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <CircuitBreakerPanel breakers={breakers} factions={factions} />
                <SentimentOverride sentiment={sentiment} />
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SignalFeed signals={signals} />
                <AuditFeed entries={audit} />
              </div>
            </OperatorGate>
          )}

          {tab === 'nft' && (
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={() => switchTab('swarm')}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Command Center
              </button>
              <NFTCollection />
            </div>
          )}

          {tab === 'signals-pro' && <SignalsPro />}

          {tab === 'swarm' && (
            <DeFiSwarmPanel />
          )}

          {tab === 'swarm-wallet' && (
            <OperatorGate status={operatorStatus}>
              <SwarmWalletSetup />
            </OperatorGate>
          )}

          {tab === 'revenue' && (
            <>
              <ProfitHistory />
              <RevenueCommandCenter />
            </>
          )}

          {tab === 'withdrawal' && (
            <OperatorGate status={operatorStatus}>
              <WithdrawalPanel />
            </OperatorGate>
          )}

          {tab === 'roadmap' && (
            <BillionRoadmap />
          )}
        </div>
        </ErrorBoundary>
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
