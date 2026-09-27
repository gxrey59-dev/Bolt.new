import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, Target, Rocket, AlertCircle,
  ArrowRight, Zap, Crown, Building2, Coins, Code, Users,
  RefreshCw, ChevronRight, Flame,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface RevenueStream {
  id: string;
  name: string;
  category: string;
  current_revenue: number;
  target_revenue: number;
  current_metric: string;
  current_value: number;
  target_value: number;
  unit: string;
  growth_rate: number;
  months_to_target: int;
  billion_share: number;
  status: string;
  blockers: string;
  next_milestone: string;
}

const CATEGORY_ICONS: Record<string, typeof DollarSign> = {
  trading: TrendingUp,
  defi: Coins,
  nft: Flame,
  saas: Code,
  licensing: Building2,
  data: Users,
};

const CATEGORY_COLORS: Record<string, string> = {
  trading: '#10b981',
  defi: '#06b6d4',
  nft: '#f59e0b',
  saas: '#8b5cf6',
  licensing: '#3b82f6',
  data: '#ec4899',
};

const STATUS_STYLES: Record<string, { text: string; bg: string; dot: string; label: string }> = {
  live: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500', label: 'LIVE' },
  scaling: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', dot: 'bg-cyan-500', label: 'SCALING' },
  planned: { text: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-500', label: 'PLANNED' },
  conceptual: { text: 'text-zinc-500', bg: 'bg-zinc-700/30', dot: 'bg-zinc-600', label: 'CONCEPT' },
};

const BILLION = 1000000000;

function formatMoney(n: number): string {
  if (n >= BILLION) return `$${(n / BILLION).toFixed(2)}B`;
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

export default function RevenueCommandCenter() {
  const [streams, setStreams] = useState<RevenueStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const { data } = await supabase.from('revenue_streams').select('*').order('target_revenue', { ascending: false });
    setStreams((data ?? []) as RevenueStream[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); const id = setInterval(fetchData, 5000); return () => clearInterval(id); }, [fetchData]);

  const totalCurrentMonthly = streams.reduce((s, r) => s + Number(r.current_revenue), 0);
  const totalTargetMonthly = streams.reduce((s, r) => s + Number(r.target_revenue), 0);
  const totalTargetAnnual = totalTargetMonthly * 12;
  const progressPct = totalTargetMonthly > 0 ? (totalCurrentMonthly / totalTargetMonthly) * 100 : 0;
  const billionProgress = totalTargetAnnual > 0 ? (totalCurrentMonthly * 12 / BILLION) * 100 : 0;
  const liveStreams = streams.filter(s => s.status === 'live' || s.status === 'scaling').length;
  const conceptStreams = streams.filter(s => s.status === 'conceptual' || s.status === 'planned').length;

  // Compound growth projection: if current monthly revenue grows at weighted avg rate, when do we hit $1B/yr?
  const weightedGrowth = streams.length > 0
    ? streams.reduce((s, r) => s + Number(r.growth_rate) * Number(r.target_revenue), 0) / totalTargetMonthly
    : 0;
  const monthsToBillion = totalCurrentMonthly > 0 && weightedGrowth > 1
    ? Math.log(BILLION / (totalCurrentMonthly * 12)) / Math.log(weightedGrowth)
    : 0;

  return (
    <section className="space-y-5">
      {/* Hero — Billion Dollar Target */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="h-6 w-6 text-amber-400" />
            <h2 className="text-xl font-bold text-zinc-100">Revenue Command Center</h2>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">$1B TARGET</span>
          </div>

          {/* Progress bar to a billion */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-500">Annual Revenue Run Rate</span>
              <span className="font-mono text-sm font-bold text-zinc-300">
                {formatMoney(totalCurrentMonthly * 12)} <span className="text-zinc-600">/ {formatMoney(BILLION)}</span>
              </span>
            </div>
            <div className="relative h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-amber-400 transition-all"
                style={{ width: `${Math.max(billionProgress, 0.5)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-bold text-white mix-blend-difference">
                  {billionProgress.toFixed(4)}% TO $1B
                </span>
              </div>
            </div>
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <DollarSign className="h-3 w-3 text-emerald-400" />
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">Monthly Now</p>
              </div>
              <p className="font-mono text-lg font-bold tabular-nums text-emerald-400">{formatMoney(totalCurrentMonthly)}</p>
            </div>
            <div className="rounded-xl bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="h-3 w-3 text-amber-400" />
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">Monthly Target</p>
              </div>
              <p className="font-mono text-lg font-bold tabular-nums text-amber-400">{formatMoney(totalTargetMonthly)}</p>
            </div>
            <div className="rounded-xl bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Rocket className="h-3 w-3 text-cyan-400" />
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">Revenue Streams</p>
              </div>
              <p className="font-mono text-lg font-bold tabular-nums text-zinc-100">
                {liveStreams}<span className="text-zinc-600 text-xs"> live</span> / {conceptStreams}<span className="text-zinc-600 text-xs"> concept</span>
              </p>
            </div>
            <div className="rounded-xl bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3 w-3 text-purple-400" />
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">Est. Time to $1B</p>
              </div>
              <p className="font-mono text-lg font-bold tabular-nums text-zinc-100">
                {monthsToBillion > 0 && monthsToBillion < 600 ? `${monthsToBillion.toFixed(0)} mo` : 'TBD'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reality Check Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-300 mb-1">Reality Check</p>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            You're currently generating {formatMoney(totalCurrentMonthly)}/month across {liveStreams} live streams.
            To reach $1B/year you need {formatMoney(BILLION / 12)}/month — that's a{' '}
            <span className="font-bold text-amber-400">{((BILLION / 12) / Math.max(totalCurrentMonthly, 0.01)).toFixed(0)}x</span> scale-up.
            The plan below maps each revenue stream, what's blocking it, and the next milestone to unlock growth.
          </p>
        </div>
      </div>

      {/* Revenue Stream Cards */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {streams.map(stream => {
            const CatIcon = CATEGORY_ICONS[stream.category] ?? DollarSign;
            const color = CATEGORY_COLORS[stream.category] ?? '#a1a1aa';
            const status = STATUS_STYLES[stream.status] ?? STATUS_STYLES.conceptual;
            const progress = stream.target_revenue > 0 ? (Number(stream.current_revenue) / Number(stream.target_revenue)) * 100 : 0;
            const metricProgress = stream.target_value > 0 ? (Number(stream.current_value) / Number(stream.target_value)) * 100 : 0;
            const isSelected = selected === stream.id;

            return (
              <div
                key={stream.id}
                className={`rounded-2xl border bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 p-4 transition-all ${
                  isSelected ? 'border-amber-500/40' : 'border-zinc-800'
                }`}
              >
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="rounded-xl p-2 flex-shrink-0" style={{ backgroundColor: `${color}15` }}>
                    <CatIcon className="h-4 w-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-zinc-100 truncate">{stream.name}</h3>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold ${status.text} ${status.bg}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600 capitalize mt-0.5">{stream.category}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] text-zinc-600">% of $1B</p>
                    <p className="font-mono text-sm font-bold" style={{ color }}>{stream.billion_share}%</p>
                  </div>
                </div>

                {/* Revenue progress */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-600">Monthly Revenue</span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {formatMoney(Number(stream.current_revenue))} <span className="text-zinc-700">/ {formatMoney(Number(stream.target_revenue))}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${Math.max(progress, 0.5)}%`, backgroundColor: color }}
                    />
                  </div>
                </div>

                {/* Key metric progress */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-600">{stream.current_metric}</span>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {formatNum(Number(stream.current_value))} <span className="text-zinc-700">/ {formatNum(Number(stream.target_value))} {stream.unit}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full transition-all opacity-60"
                      style={{ width: `${Math.max(metricProgress, 0.5)}%`, backgroundColor: color }}
                    />
                  </div>
                </div>

                {/* Growth + timeline */}
                <div className="flex items-center gap-3 mb-3 text-[10px]">
                  <span className="flex items-center gap-1 text-zinc-500">
                    <TrendingUp className="h-3 w-3" />
                    {Number(stream.growth_rate).toFixed(1)}x/mo growth
                  </span>
                  <span className="flex items-center gap-1 text-zinc-500">
                    <Target className="h-3 w-3" />
                    {stream.months_to_target} mo to target
                  </span>
                </div>

                {/* Expandable details */}
                <button
                  onClick={() => setSelected(isSelected ? null : stream.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-zinc-950/40 p-2 text-[10px] text-zinc-500 hover:bg-zinc-900/60 transition-colors"
                >
                  <span>{isSelected ? 'Hide details' : 'Show blockers & milestones'}</span>
                  <ChevronRight className={`h-3 w-3 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                </button>

                {isSelected && (
                  <div className="mt-2 space-y-2 animate-fade-in">
                    {/* Blockers */}
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 mb-1">
                        <AlertCircle className="h-3 w-3" />
                        What's Blocking Growth
                      </p>
                      <p className="text-[10px] leading-relaxed text-zinc-400">{stream.blockers}</p>
                    </div>

                    {/* Next milestone */}
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 mb-1">
                        <ArrowRight className="h-3 w-3" />
                        Next Milestone
                      </p>
                      <p className="text-[10px] leading-relaxed text-zinc-400">{stream.next_milestone}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Path to $1B Summary */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Rocket className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-bold text-zinc-100">The Path to $1,000,000,000</h3>
        </div>

        <div className="space-y-3">
          {[
            { phase: 'Phase 1', title: 'Prove the Engine', target: '$10K/mo', timeline: '0-3 months', items: ['Scale trading capital from $22 to $100K', 'Improve win rate from 33% to 55%+', 'Get first NFT mints (deploy on-chain)', 'Connect real DeFi wallets'] },
            { phase: 'Phase 2', title: 'Productize', target: '$100K/mo', timeline: '3-9 months', items: ['Launch signal subscription SaaS (Stripe)', 'List NFTs on OpenSea/Magic Eden', 'Scale DeFi TVL to $1M+', 'Package strategies for licensing'] },
            { phase: 'Phase 3', title: 'Scale & Distribute', target: '$1M/mo', timeline: '9-18 months', items: ['10K+ SaaS subscribers at $50-100/mo', 'NFT secondary market royalties', '$10M+ DeFi TVL across swarms', 'White-label strategy to 50+ funds'] },
            { phase: 'Phase 4', title: 'Institutional & DAO', target: '$10M/mo', timeline: '18-36 months', items: ['Launch faction DAO with governance token', '$100M+ treasury AUM', 'Institutional trading desk', 'API platform for swarm intelligence'] },
          ].map((p, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-400">
                  {i + 1}
                </div>
                {i < 3 && <div className="w-px flex-1 bg-zinc-800 mt-1" />}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[10px] font-bold text-amber-400">{p.phase}</span>
                  <h4 className="text-xs font-bold text-zinc-200">{p.title}</h4>
                  <span className="text-[10px] text-zinc-600">·</span>
                  <span className="text-[10px] text-emerald-400 font-mono">{p.target}</span>
                  <span className="text-[10px] text-zinc-600">·</span>
                  <span className="text-[10px] text-zinc-500">{p.timeline}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.items.map((item, j) => (
                    <span key={j} className="rounded-md bg-zinc-800/50 px-2 py-0.5 text-[9px] text-zinc-400">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
