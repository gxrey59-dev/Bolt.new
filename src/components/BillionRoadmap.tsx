import { useState } from 'react';
import {
  Crown, Rocket, TrendingUp, Building2, Globe, CheckCircle2,
  Circle, ArrowRight, ChevronDown, Target,
} from 'lucide-react';

interface Milestone {
  label: string;
  done?: boolean;
}

interface Phase {
  id: number;
  name: string;
  target: string;
  timeline: string;
  icon: typeof Rocket;
  accent: string;
  glow: string;
  milestones: Milestone[];
}

const PHASES: Phase[] = [
  {
    id: 1,
    name: 'Prove the Engine',
    target: '$10K/mo',
    timeline: '0–3 months',
    icon: Rocket,
    accent: 'text-emerald-400',
    glow: 'from-emerald-500/15',
    milestones: [
      { label: 'Scale trading capital from $22 to $100K', done: false },
      { label: 'Improve win rate from 33% to 55%+', done: false },
      { label: 'Get first NFT mints (deploy on-chain)', done: false },
      { label: 'Connect real DeFi wallets', done: false },
    ],
  },
  {
    id: 2,
    name: 'Productize',
    target: '$100K/mo',
    timeline: '3–9 months',
    icon: TrendingUp,
    accent: 'text-cyan-400',
    glow: 'from-cyan-500/15',
    milestones: [
      { label: 'Launch signal subscription SaaS (Stripe)', done: false },
      { label: 'List NFTs on OpenSea/Magic Eden', done: false },
      { label: 'Scale DeFi TVL to $1M+', done: false },
      { label: 'Package strategies for licensing', done: false },
    ],
  },
  {
    id: 3,
    name: 'Scale & Distribute',
    target: '$1M/mo',
    timeline: '9–18 months',
    icon: Building2,
    accent: 'text-amber-400',
    glow: 'from-amber-500/15',
    milestones: [
      { label: '10K+ SaaS subscribers at $50–100/mo', done: false },
      { label: 'NFT secondary market royalties', done: false },
      { label: '$10M+ DeFi TVL across swarms', done: false },
      { label: 'White-label strategy to 50+ funds', done: false },
    ],
  },
  {
    id: 4,
    name: 'Institutional & DAO',
    target: '$10M/mo',
    timeline: '18–36 months',
    icon: Globe,
    accent: 'text-purple-400',
    glow: 'from-purple-500/15',
    milestones: [
      { label: 'Launch faction DAO with governance token', done: false },
      { label: '$100M+ treasury AUM', done: false },
      { label: 'Institutional trading desk', done: false },
      { label: 'API platform for swarm intelligence', done: false },
    ],
  },
];

export default function BillionRoadmap() {
  const [expanded, setExpanded] = useState<number | null>(1);

  return (
    <section className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -left-12 -bottom-12 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="h-6 w-6 text-amber-400" />
            <h2 className="text-xl font-bold text-zinc-100">The Path to $1,000,000,000</h2>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">ROADMAP</span>
          </div>
          <p className="text-sm text-zinc-400 max-w-2xl">
            Four phases from proving the engine to institutional scale. Each phase sets a monthly
            revenue target and the milestones required to unlock the next.
          </p>

          {/* Cumulative revenue axis */}
          <div className="mt-5 flex items-center gap-1">
            {PHASES.map((p, i) => (
              <div key={p.id} className="flex-1">
                <div
                  className={`h-2 rounded-full bg-gradient-to-r ${p.glow} to-transparent`}
                  style={{ opacity: expanded === p.id ? 1 : 0.5 }}
                />
                <div className="mt-1.5 flex items-center justify-between">
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${p.accent}`}>
                    Phase {p.id}
                  </span>
                  {i < PHASES.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-zinc-700" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase cards */}
      <div className="space-y-3">
        {PHASES.map(phase => {
          const Icon = phase.icon;
          const isOpen = expanded === phase.id;
          const doneCount = phase.milestones.filter(m => m.done).length;
          const progress = (doneCount / phase.milestones.length) * 100;

          return (
            <div
              key={phase.id}
              className={`rounded-2xl border bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 transition-all ${
                isOpen ? 'border-amber-500/30' : 'border-zinc-800'
              }`}
            >
              <button
                onClick={() => setExpanded(isOpen ? null : phase.id)}
                className="flex w-full items-center gap-4 p-5 text-left"
              >
                {/* Phase number badge */}
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${phase.glow} to-transparent flex-shrink-0`}>
                  <Icon className={`h-5 w-5 ${phase.accent}`} />
                </div>

                {/* Phase info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${phase.accent}`}>
                      Phase {phase.id}
                    </span>
                    <h3 className="text-base font-bold text-zinc-100">{phase.name}</h3>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      {phase.target}
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span>{phase.timeline}</span>
                  </div>
                </div>

                {/* Progress mini-bar */}
                <div className="hidden sm:block flex-shrink-0 w-28">
                  <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all ${phase.accent.replace('text-', 'bg-')}`}
                      style={{ width: `${Math.max(progress, 2)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[9px] text-zinc-600">
                    {doneCount}/{phase.milestones.length} done
                  </p>
                </div>

                <ChevronDown className={`h-4 w-4 text-zinc-600 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded milestones */}
              {isOpen && (
                <div className="border-t border-zinc-800/60 px-5 pb-5 pt-4 animate-fade-in">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {phase.milestones.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-lg bg-zinc-950/50 px-3 py-2.5"
                      >
                        {m.done ? (
                          <CheckCircle2 className={`h-4 w-4 flex-shrink-0 mt-0.5 ${phase.accent}`} />
                        ) : (
                          <Circle className="h-4 w-4 flex-shrink-0 mt-0.5 text-zinc-700" />
                        )}
                        <span className={`text-xs leading-relaxed ${m.done ? 'text-zinc-300' : 'text-zinc-400'}`}>
                          {m.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
