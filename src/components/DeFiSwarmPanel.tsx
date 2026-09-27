import { useState, useEffect, useCallback } from 'react';
import {
  Network, Activity, Layers, Zap, TrendingUp, TrendingDown,
  Boxes, Cpu, AlertTriangle, RefreshCw, ChevronDown, ChevronRight,
  DollarSign, Gauge, Bot, Circle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FACTIONS } from '@/lib/constants';

interface Swarm {
  id: string;
  name: string;
  faction_id: string;
  protocol: string;
  chain: string;
  agent_count: number;
  active_agents: number;
  total_tvl: number;
  total_yield_24h: number;
  total_yield_7d: number;
  apy: number;
  strategies: string[];
  status: string;
  risk_level: string;
  gas_efficiency: number;
  rebalance_count: number;
  last_rebalance_at: string | null;
}

interface SwarmAgent {
  id: string;
  swarm_id: string;
  name: string;
  role: string;
  protocol: string;
  pool_address: string;
  capital_allocated: number;
  current_value: number;
  yield_24h: number;
  apy: number;
  status: string;
  last_action: string;
  last_action_at: string | null;
  action_count: number;
}

const PROTOCOL_ICONS: Record<string, string> = {
  uniswap_v3: '🦄', aave_v3: '👻', compound_v3: '📊', curve: '🌊', balancer: '⚖️',
};

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627eea', arbitrum: '#28a0f0', polygon: '#8247e5', base: '#0052ff', optimism: '#ff0420',
};

const RISK_STYLES: Record<string, { text: string; bg: string }> = {
  low: { text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  medium: { text: 'text-amber-400', bg: 'bg-amber-500/15' },
  high: { text: 'text-orange-400', bg: 'bg-orange-500/15' },
  extreme: { text: 'text-red-400', bg: 'bg-red-500/15' },
};

const STATUS_STYLES: Record<string, { text: string; dot: string }> = {
  active: { text: 'text-emerald-400', dot: 'bg-emerald-500' },
  idle: { text: 'text-zinc-500', dot: 'bg-zinc-600' },
  rebalancing: { text: 'text-amber-400', dot: 'bg-amber-500' },
  migrating: { text: 'text-blue-400', dot: 'bg-blue-500' },
  error: { text: 'text-red-400', dot: 'bg-red-500' },
  paused: { text: 'text-zinc-500', dot: 'bg-zinc-600' },
};

const ROLE_ICONS: Record<string, typeof Bot> = {
  liquidity_provider: Layers,
  yield_farmer: TrendingUp,
  arbitrageur: Zap,
  hedger: Shield,
  sentinel: Activity,
  harvester: DollarSign,
};

import { Shield } from 'lucide-react';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function DeFiSwarmPanel() {
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [agents, setAgents] = useState<Record<string, SwarmAgent[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [swRes, agRes] = await Promise.all([
      supabase.from('defi_swarms').select('*').order('total_tvl', { ascending: false }),
      supabase.from('defi_swarm_agents').select('*').order('apy', { ascending: false }),
    ]);
    setSwarms((swRes.data ?? []) as Swarm[]);
    const agentMap: Record<string, SwarmAgent[]> = {};
    for (const a of (agRes.data ?? []) as SwarmAgent[]) {
      if (!agentMap[a.swarm_id]) agentMap[a.swarm_id] = [];
      agentMap[a.swarm_id].push(a);
    }
    setAgents(agentMap);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); const id = setInterval(fetchData, 5000); return () => clearInterval(id); }, [fetchData]);

  const totalTVL = swarms.reduce((s, w) => s + Number(w.total_tvl), 0);
  const totalYield24h = swarms.reduce((s, w) => s + Number(w.total_yield_24h), 0);
  const totalYield7d = swarms.reduce((s, w) => s + Number(w.total_yield_7d), 0);
  const totalAgents = swarms.reduce((s, w) => s + w.agent_count, 0);
  const activeAgents = swarms.reduce((s, w) => s + w.active_agents, 0);
  const blendedAPY = totalTVL > 0 ? swarms.reduce((s, w) => s + Number(w.apy) * Number(w.total_tvl), 0) / totalTVL : 0;

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-zinc-100">DeFi Swarm Intelligence</h2>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-bold text-cyan-400">
          <Bot className="h-3 w-3" />
          {activeAgents} / {totalAgents} AGENTS LIVE
        </span>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Boxes className="h-3.5 w-3.5 text-cyan-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Total TVL</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            ${totalTVL.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Yield 24h</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-emerald-400">
            +${totalYield24h.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Yield 7d</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-emerald-400">
            +${totalYield7d.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Percent className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Blended APY</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-amber-400">
            {blendedAPY.toFixed(1)}%
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Cpu className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Swarms</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">{swarms.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Gauge className="h-3.5 w-3.5 text-purple-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-600">Rebalances</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {swarms.reduce((s, w) => s + w.rebalance_count, 0)}
          </p>
        </div>
      </div>

      {/* Swarm Cards */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="space-y-3">
          {swarms.map(swarm => {
            const factionMeta = FACTIONS.find(f => f.id === swarm.faction_id);
            const chainColor = CHAIN_COLORS[swarm.chain] ?? '#a1a1aa';
            const riskStyle = RISK_STYLES[swarm.risk_level] ?? RISK_STYLES.medium;
            const statusStyle = STATUS_STYLES[swarm.status] ?? STATUS_STYLES.active;
            const swarmAgents = agents[swarm.id] ?? [];
            const isExpanded = expanded === swarm.id;
            const activeCount = swarmAgents.filter(a => a.status === 'active').length;
            const errorCount = swarmAgents.filter(a => a.status === 'error').length;
            const agentTVL = swarmAgents.reduce((s, a) => s + Number(a.current_value), 0);

            return (
              <div
                key={swarm.id}
                className={`rounded-2xl border bg-gradient-to-br from-zinc-900/90 to-zinc-950/90 transition-all ${
                  isExpanded ? 'border-cyan-500/40' : 'border-zinc-800'
                }`}
              >
                {/* Swarm header row */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : swarm.id)}
                >
                  {/* Expand icon */}
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 flex-shrink-0 text-zinc-500" />
                    : <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
                  }

                  {/* Protocol icon */}
                  <span className="text-2xl flex-shrink-0">{PROTOCOL_ICONS[swarm.protocol] ?? '🔧'}</span>

                  {/* Name + chain */}
                  <div className="flex-shrink-0 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-zinc-100 truncate">{swarm.name}</h3>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${statusStyle.text} ${statusStyle.dot === 'bg-emerald-500' ? 'bg-emerald-500/10' : 'bg-zinc-800'}`}>
                        <Circle className="h-1.5 w-1.5 fill-current" />
                        {swarm.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chainColor }} />
                        {swarm.chain}
                      </span>
                      <span className="text-[10px] text-zinc-600">·</span>
                      <span className="text-[10px] text-zinc-500">{factionMeta?.name ?? swarm.faction_id}</span>
                      <span className="text-[10px] text-zinc-600">·</span>
                      <span className={`text-[10px] font-bold ${riskStyle.text}`}>{swarm.risk_level.toUpperCase()} RISK</span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="ml-auto flex items-center gap-4 sm:gap-6">
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600">TVL</p>
                      <p className="font-mono text-sm font-bold tabular-nums text-zinc-100">
                        ${Number(swarm.total_tvl).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600">24h Yield</p>
                      <p className="font-mono text-sm font-bold tabular-nums text-emerald-400">
                        +${Number(swarm.total_yield_24h).toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600">APY</p>
                      <p className="font-mono text-sm font-bold tabular-nums text-amber-400">
                        {Number(swarm.apy).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Agents</p>
                      <p className="font-mono text-sm font-bold tabular-nums text-zinc-300">
                        {activeCount}/{swarm.agent_count}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Expanded agent list */}
                {isExpanded && (
                  <div className="border-t border-zinc-800/60 p-4 space-y-2 animate-fade-in">
                    {/* Strategies tags */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {swarm.strategies.map(s => (
                        <span key={s} className="rounded-md bg-zinc-800/60 px-2 py-0.5 text-[9px] font-semibold text-zinc-400">
                          {s.replace(/_/g, ' ')}
                        </span>
                      ))}
                      <span className="flex items-center gap-1 rounded-md bg-zinc-800/60 px-2 py-0.5 text-[9px] font-semibold text-zinc-500">
                        <Gauge className="h-2.5 w-2.5" />
                        gas eff {(Number(swarm.gas_efficiency) * 100).toFixed(0)}%
                      </span>
                      <span className="flex items-center gap-1 rounded-md bg-zinc-800/60 px-2 py-0.5 text-[9px] font-semibold text-zinc-500">
                        <RefreshCw className="h-2.5 w-2.5" />
                        {swarm.rebalance_count} rebalances
                      </span>
                    </div>

                    {/* Error banner */}
                    {errorCount > 0 && (
                      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 mb-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                        <p className="text-[11px] text-red-400">{errorCount} agent{errorCount > 1 ? 's' : ''} in error state — requires attention</p>
                      </div>
                    )}

                    {/* Agent rows */}
                    {swarmAgents.length === 0 ? (
                      <p className="text-center text-xs text-zinc-600 py-4">No agents deployed</p>
                    ) : (
                      swarmAgents.map(agent => {
                        const RoleIcon = ROLE_ICONS[agent.role] ?? Bot;
                        const agStatus = STATUS_STYLES[agent.status] ?? STATUS_STYLES.active;
                        const pnl = Number(agent.current_value) - Number(agent.capital_allocated);
                        const pnlPositive = pnl >= 0;

                        return (
                          <div
                            key={agent.id}
                            className="flex items-center gap-3 rounded-xl bg-zinc-950/60 p-3 hover:bg-zinc-900/60 transition-colors"
                          >
                            {/* Role icon */}
                            <div className="flex-shrink-0 rounded-lg bg-zinc-800/80 p-2">
                              <RoleIcon className="h-3.5 w-3.5 text-zinc-400" />
                            </div>

                            {/* Name + role */}
                            <div className="flex-shrink-0 min-w-0 w-28">
                              <p className="text-xs font-bold text-zinc-200 truncate">{agent.name}</p>
                              <p className="text-[9px] text-zinc-600 capitalize">{agent.role.replace(/_/g, ' ')}</p>
                            </div>

                            {/* Status dot */}
                            <div className="flex-shrink-0 flex items-center gap-1">
                              <span className={`h-2 w-2 rounded-full ${agStatus.dot} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
                              <span className={`text-[9px] font-semibold ${agStatus.text}`}>{agent.status}</span>
                            </div>

                            {/* Pool address */}
                            <div className="hidden lg:block flex-shrink-0 min-w-0 w-32">
                              <p className="font-mono text-[10px] text-zinc-600 truncate">{agent.pool_address}</p>
                            </div>

                            {/* Capital */}
                            <div className="hidden sm:block text-right flex-shrink-0 w-20">
                              <p className="text-[9px] text-zinc-600">Capital</p>
                              <p className="font-mono text-[11px] font-semibold tabular-nums text-zinc-300">
                                ${Number(agent.capital_allocated).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </p>
                            </div>

                            {/* P&L */}
                            <div className="hidden sm:block text-right flex-shrink-0 w-20">
                              <p className="text-[9px] text-zinc-600">P&L</p>
                              <p className={`font-mono text-[11px] font-bold tabular-nums ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pnlPositive ? '+' : ''}${pnl.toFixed(2)}
                              </p>
                            </div>

                            {/* APY */}
                            <div className="text-right flex-shrink-0 w-16">
                              <p className="text-[9px] text-zinc-600">APY</p>
                              <p className="font-mono text-[11px] font-bold tabular-nums text-amber-400">
                                {Number(agent.apy).toFixed(1)}%
                              </p>
                            </div>

                            {/* Last action */}
                            <div className="hidden xl:block flex-1 min-w-0 ml-2">
                              <p className="text-[10px] text-zinc-500 truncate">{agent.last_action}</p>
                              <p className="text-[9px] text-zinc-600">{timeAgo(agent.last_action_at)} · {agent.action_count} actions</p>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Swarm footer */}
                    <div className="flex items-center justify-between pt-2 text-[10px] text-zinc-600">
                      <span>Agent TVL: ${agentTVL.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                      <span>Last rebalance: {timeAgo(swarm.last_rebalance_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
