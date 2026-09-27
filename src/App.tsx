import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Monitor, Table, Settings, Radio, Gem } from 'lucide-react';
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

const TABS: { id: TabId; label: string; icon: typeof Monitor }[] = [
  { id: 'live', label: 'Live Terminal', icon: Radio },
  { id: 'command', label: 'Command Center', icon: Monitor },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'table', label: 'Table View', icon: Table },
  { id: 'operations', label: 'Operations', icon: Settings },
  { id: 'nft', label: 'NFT Armory', icon: Gem },
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
