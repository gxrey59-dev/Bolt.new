import { useEffect, useState, useCallback } from 'react';
import { Network, Bot, Boxes, DollarSign, Percent, Activity, ChevronRight, ChevronDown, RefreshCw, Wallet, Square, Play, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const CONNECTED_WALLET = '0xb4d70fcFE953b9a563DD96Ee59D17082Db253098';
const PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const RPC = 'https://polygon-bor-rpc.publicnode.com';
const POLYGONSCAN = `https://polygonscan.com/address/${CONNECTED_WALLET}`;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

type Rpc = (method: string, params: unknown[], signal: AbortSignal) => Promise<unknown>;
type Snapshot = {
  block: string;
  blockTime: number;
  checkedAt: string;
  pool: string;
  wallet: string | null;
  nativeBalance: string | null;
  collateral: string | null;
  debt: string | null;
  health: string | null;
  currency: string;
};
type WalletProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

interface SwarmRow {
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
  wallet_address: string;
}

interface AgentRow {
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
  wallet_address: string;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid hexadecimal RPC response.');
  return BigInt(value);
}
function decimal(value: bigint, scale: bigint, places = 6): string {
  if (scale <= 0n) throw new Error('Invalid oracle unit.');
  const fraction = ((value % scale) * 10n ** BigInt(places) / scale).toString().padStart(places, '0').replace(/0+$/, '');
  return (value / scale).toString() + (fraction ? '.' + fraction : '');
}
function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(value)) throw new Error('Invalid contract address response.');
  const address = '0x' + value.slice(-40);
  if (/^0x0{40}$/.test(address)) throw new Error('Contract address is not configured.');
  return address;
}
async function rpc(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
  const response = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal });
  if (!response.ok) throw new Error(`Polygon RPC returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || 'Polygon RPC rejected the request.');
  if (body.id !== 1 || !('result' in body)) throw new Error('Invalid RPC response.');
  return body.result;
}
async function readSnapshot(request: Rpc, wallet: string, signal: AbortSignal): Promise<Snapshot> {
  if (wallet && (!addressPattern.test(wallet) || /^0x0{40}$/i.test(wallet))) throw new Error('Enter a valid, nonzero public wallet address.');
  if (quantity(await request('eth_chainId', [], signal)) !== 137n) throw new Error('Wrong network: Polygon mainnet is required.');
  const blockInfo = await request('eth_getBlockByNumber', ['latest', false], signal) as { timestamp?: unknown; number?: unknown } | null;
  if (!blockInfo) throw new Error('The RPC did not return a block header.');
  const block = blockInfo.number;
  quantity(block);
  const blockTime = Number(quantity(blockInfo.timestamp)) * 1000;
  if (Date.now() - blockTime > 180000 || blockTime - Date.now() > 30000) throw new Error('RPC block is stale or has an invalid timestamp.');
  const call = (to: string, data: string) => request('eth_call', [{ to, data }, block], signal);
  const pool = decodeAddress(await call(PROVIDER, '0x026b1d5f'));
  const code = await request('eth_getCode', [pool, block], signal);
  if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || code === '0x0') throw new Error('Aave pool bytecode was not found.');
  const result: Snapshot = { block: quantity(block).toString(), blockTime, checkedAt: new Date().toISOString(), pool, wallet: wallet || null, nativeBalance: null, collateral: null, debt: null, health: null, currency: '' };
  if (!wallet) return result;
  const oracle = decodeAddress(await call(PROVIDER, '0xfca513a8'));
  const [account, balance, unit, base] = await Promise.all([
    call(pool, '0xbf92857c' + wallet.slice(2).padStart(64, '0')),
    request('eth_getBalance', [wallet, block], signal),
    call(oracle, '0x8c89b64f'), call(oracle, '0xe19f4700'),
  ]);
  if (typeof account !== 'string' || !/^0x[0-9a-f]{384}$/i.test(account)) throw new Error('Aave returned an invalid account snapshot.');
  const values = Array.from({ length: 6 }, (_, i) => BigInt('0x' + account.slice(2 + i * 64, 66 + i * 64)));
  if (typeof base !== 'string' || !/^0x[0-9a-f]{64}$/i.test(base)) throw new Error('Invalid oracle base currency.');
  result.currency = quantity(base) === 0n ? 'USD' : decodeAddress(base);
  result.nativeBalance = decimal(quantity(balance), 10n ** 18n);
  result.collateral = decimal(values[0], quantity(unit), 2);
  result.debt = decimal(values[1], quantity(unit), 2);
  result.health = values[1] === 0n ? 'No debt' : decimal(values[5], 10n ** 18n, 4);
  return result;
}

const PROTOCOL_META: Record<string, { icon: string; chain: string; faction: string }> = {
  aave_v3: { icon: '🏦', chain: 'Polygon', faction: 'The Chef' },
  uniswap_v3: { icon: '🦄', chain: 'Arbitrum', faction: 'The Genius' },
  curve: { icon: '🌊', chain: 'Ethereum', faction: 'Tony Starks' },
  compound_v3: { icon: '📊', chain: 'Base', faction: 'Meth Lab' },
  balancer: { icon: '⚖️', chain: 'Optimism', faction: 'U-God' },
};

export default function DeFiSwarmPanel() {
  const [wallet, setWallet] = useState(CONNECTED_WALLET);
  const [running, setRunning] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState<string | null>('aave_v3');
  const [swarms, setSwarms] = useState<SwarmRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [dbLoading, setDbLoading] = useState(true);

  const fetchDbData = useCallback(async () => {
    const [{ data: s }, { data: a }] = await Promise.all([
      supabase.from('defi_swarms').select('*').order('total_tvl', { ascending: false }),
      supabase.from('defi_swarm_agents').select('*').order('yield_24h', { ascending: false }),
    ]);
    setSwarms((s ?? []) as SwarmRow[]);
    setAgents((a ?? []) as AgentRow[]);
    setDbLoading(false);
  }, []);

  useEffect(() => {
    fetchDbData();
    const id = setInterval(fetchDbData, 15000);
    return () => clearInterval(id);
  }, [fetchDbData]);

  useEffect(() => {
    if (!running) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      setLoading(true);
      try {
        const next = await readSnapshot(rpc, wallet.trim(), controller.signal);
        if (!disposed) { setSnapshot(next); setError(''); }
      } catch (cause) {
        if (!disposed) {
          setSnapshot(null);
          setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Live checks timed out. Retry when the network is available.');
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed) { setLoading(false); timer = setTimeout(() => void poll(), 30000); }
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [running, wallet, refresh]);

  function stop() { setRunning(false); setSnapshot(null); setLoading(false); setError(''); }

  const healthy = running && snapshot !== null && !error;
  const connectedSwarm = swarms.find(s => s.wallet_address === CONNECTED_WALLET);
  const connectedAgents = agents.filter(a => a.swarm_id === connectedSwarm?.id);

  const totalTvl = swarms.reduce((s, w) => s + Number(w.total_tvl), 0);
  const totalYield24h = swarms.reduce((s, w) => s + Number(w.total_yield_24h), 0);
  const totalYield7d = swarms.reduce((s, w) => s + Number(w.total_yield_7d), 0);
  const activeAgents = swarms.reduce((s, w) => s + w.active_agents, 0);
  const totalRebalances = swarms.reduce((s, w) => s + w.rebalance_count, 0);
  const avgApy = swarms.length > 0 ? swarms.reduce((s, w) => s + Number(w.apy), 0) / swarms.length : 0;

  const stats = [
    { label: 'Total TVL', value: `$${totalTvl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Boxes },
    { label: 'Yield 24h', value: `$${totalYield24h.toFixed(2)}`, icon: DollarSign },
    { label: 'Yield 7d', value: `$${totalYield7d.toFixed(2)}`, icon: DollarSign },
    { label: 'Avg APY', value: `${avgApy.toFixed(1)}%`, icon: Percent },
    { label: 'Active Agents', value: String(activeAgents), icon: Bot },
    { label: 'Rebalances', value: String(totalRebalances), icon: Activity },
  ];

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Network className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-zinc-100">DeFi Swarm Intelligence</h2>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${healthy ? 'bg-emerald-500/15 text-emerald-400' : error ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {healthy ? 'ON-CHAIN MONITORING' : error ? 'CONNECTION ERROR' : running ? 'CONNECTING' : 'NOT RUNNING'}
        </span>
        <a href={POLYGONSCAN} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
          <ExternalLink className="h-3.5 w-3.5" /> View on PolygonScan
        </a>
      </div>

      {/* Connected Wallet Card */}
      <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-zinc-950 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10">
              <Wallet className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Connected Wallet</p>
              <p className="font-mono text-sm text-zinc-200">{CONNECTED_WALLET.slice(0, 8)}...{CONNECTED_WALLET.slice(-6)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={loading} onClick={() => { setSnapshot(null); setError(''); setRunning(true); setRefresh(v => v + 1); }} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white disabled:opacity-50">
              {loading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Play className="mr-2 inline h-4 w-4" />}Run live checks
            </button>
            {running && <button onClick={stop} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"><Square className="mr-2 inline h-4 w-4" />Stop</button>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[9px] uppercase text-zinc-600">POL Balance</p>
            <p className="font-mono text-sm text-zinc-200">{snapshot?.nativeBalance ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-zinc-600">Collateral</p>
            <p className="font-mono text-sm text-emerald-400">{snapshot?.collateral ? `${snapshot.collateral} ${snapshot.currency}` : '—'}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-zinc-600">Debt</p>
            <p className="font-mono text-sm text-red-400">{snapshot?.debt ? `${snapshot.debt} ${snapshot.currency}` : '—'}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-zinc-600">Health Factor</p>
            <p className="font-mono text-sm text-zinc-200">{snapshot?.health ?? '—'}</p>
          </div>
        </div>
        {snapshot && <p className="mt-2 text-[10px] text-cyan-500">Block {snapshot.block} · Pool: {snapshot.pool.slice(0, 8)}...{snapshot.pool.slice(-6)}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(stat => (
          <div key={stat.label} className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4">
            <div className="mb-1.5 flex items-center gap-1.5">
              <stat.icon className="h-3.5 w-3.5 text-cyan-400" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</p>
            </div>
            <p className="font-mono text-xl font-bold text-zinc-100 break-all">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Swarm Cards from DB */}
      {dbLoading ? (
        <div className="flex h-32 items-center justify-center">
          <RefreshCw className="h-5 w-5 animate-spin text-zinc-700" />
        </div>
      ) : (
        <div className="space-y-3">
          {swarms.map(swarm => {
            const meta = PROTOCOL_META[swarm.protocol] ?? { icon: '🤖', chain: swarm.chain, faction: swarm.faction_id };
            const swarmAgents = agents.filter(a => a.swarm_id === swarm.id);
            const isExpanded = expanded === swarm.id;
            const isLive = swarm.wallet_address === CONNECTED_WALLET;
            return (
              <div key={swarm.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
                <button aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : swarm.id)} className="flex w-full items-center gap-4 p-5 text-left">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
                  <span className="text-2xl">{meta.icon}</span>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-zinc-200">{swarm.name}</h3>
                    <p className="text-[10px] text-zinc-500">{meta.chain} · {meta.faction} · {swarm.protocol.replace(/_/g, ' ').toUpperCase()}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isLive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                    {isLive ? (healthy ? 'LIVE MONITORING' : 'CONNECTED' ) : swarm.status.toUpperCase()}
                  </span>
                  <div className="hidden text-right sm:block">
                    <p className="text-[9px] text-zinc-500">TVL</p>
                    <p className="font-mono text-sm text-zinc-200">${Number(swarm.total_tvl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                  </div>
                  <div className="hidden text-right md:block">
                    <p className="text-[9px] text-zinc-500">APY</p>
                    <p className="font-mono text-sm text-cyan-400">{Number(swarm.apy).toFixed(1)}%</p>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-zinc-800 p-5 space-y-4">
                    {/* Swarm summary */}
                    <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                      <div><p className="text-[9px] uppercase text-zinc-600">Agents</p><p className="font-mono text-sm text-zinc-200">{swarm.active_agents}/{swarm.agent_count}</p></div>
                      <div><p className="text-[9px] uppercase text-zinc-600">Yield 24h</p><p className="font-mono text-sm text-emerald-400">${Number(swarm.total_yield_24h).toFixed(2)}</p></div>
                      <div><p className="text-[9px] uppercase text-zinc-600">Yield 7d</p><p className="font-mono text-sm text-emerald-400">${Number(swarm.total_yield_7d).toFixed(2)}</p></div>
                      <div><p className="text-[9px] uppercase text-zinc-600">Risk</p><p className={`font-mono text-sm capitalize ${swarm.risk_level === 'low' ? 'text-emerald-400' : swarm.risk_level === 'high' ? 'text-red-400' : 'text-amber-400'}`}>{swarm.risk_level}</p></div>
                      <div><p className="text-[9px] uppercase text-zinc-600">Gas Eff.</p><p className="font-mono text-sm text-zinc-200">{(Number(swarm.gas_efficiency) * 100).toFixed(0)}%</p></div>
                      <div><p className="text-[9px] uppercase text-zinc-600">Rebalances</p><p className="font-mono text-sm text-zinc-200">{swarm.rebalance_count}</p></div>
                    </div>

                    {/* On-chain data for live swarm */}
                    {isLive && snapshot && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-500 mb-2">On-Chain Position (Aave V3 · Polygon)</p>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <div><p className="text-[9px] text-zinc-600">Wallet POL</p><p className="font-mono text-sm text-zinc-200">{snapshot.nativeBalance ?? '—'}</p></div>
                          <div><p className="text-[9px] text-zinc-600">Collateral</p><p className="font-mono text-sm text-emerald-400">{snapshot.collateral ? `${snapshot.collateral} ${snapshot.currency}` : '—'}</p></div>
                          <div><p className="text-[9px] text-zinc-600">Debt</p><p className="font-mono text-sm text-red-400">{snapshot.debt ? `${snapshot.debt} ${snapshot.currency}` : '—'}</p></div>
                          <div><p className="text-[9px] text-zinc-600">Health</p><p className="font-mono text-sm text-zinc-200">{snapshot.health ?? '—'}</p></div>
                        </div>
                        <p className="mt-2 break-all text-[10px] text-emerald-500/70">Pool: {snapshot.pool} · Block: {snapshot.block}</p>
                      </div>
                    )}

                    {/* Strategies */}
                    <div className="flex flex-wrap gap-1.5">
                      {swarm.strategies.map(s => (
                        <span key={s} className="rounded-full bg-zinc-800 px-2.5 py-1 text-[10px] font-medium text-zinc-400 capitalize">{s.replace(/_/g, ' ')}</span>
                      ))}
                    </div>

                    {/* Agent list */}
                    {swarmAgents.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-600">Agents</p>
                        {swarmAgents.map(agent => (
                          <div key={agent.id} className="flex items-center gap-3 rounded-lg bg-zinc-950/40 px-3 py-2 text-xs">
                            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${agent.status === 'active' ? 'bg-emerald-500' : agent.status === 'idle' ? 'bg-amber-500' : agent.status === 'error' ? 'bg-red-500' : 'bg-zinc-600'}`} />
                            <span className="font-mono font-bold text-zinc-300 flex-shrink-0 w-20">{agent.name}</span>
                            <span className="text-[10px] text-zinc-600 capitalize flex-shrink-0 hidden sm:block">{agent.role.replace(/_/g, ' ')}</span>
                            <span className="text-[10px] text-zinc-500 flex-1 truncate hidden md:block">{agent.last_action}</span>
                            <span className="font-mono text-[10px] text-zinc-500 flex-shrink-0">${Number(agent.capital_allocated).toFixed(0)}</span>
                            <span className="font-mono text-[10px] text-emerald-400 flex-shrink-0">+${Number(agent.yield_24h).toFixed(2)}</span>
                            <span className="font-mono text-[10px] text-cyan-400 flex-shrink-0">{Number(agent.apy).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
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
