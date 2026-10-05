import { useEffect, useState } from 'react';
import { Network, Bot, Boxes, DollarSign, Percent, Activity, ChevronRight, ChevronDown, RefreshCw, Wallet, Square, Play } from 'lucide-react';

// Aave's canonical Polygon addresses provider. Resolve its current pool and oracle
// at the same block as each account snapshot; never consume seeded DB earnings.
const PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const RPC = 'https://polygon-bor-rpc.publicnode.com';
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
type Rpc = (method: string, params: unknown[], signal: AbortSignal) => Promise<unknown>;
type Snapshot = { block: string; blockTime: number; checkedAt: string; pool: string; wallet: string | null; nativeBalance: string | null; collateral: string | null; debt: string | null; health: string | null; currency: string };
type WalletProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
const cards = [
  { name: 'Supreme Clientele Pool', icon: '🌊', chain: 'Ethereum', faction: 'Tony Starks', protocol: 'Curve' },
  { name: 'Liquid Swords Swarm', icon: '🦄', chain: 'Arbitrum', faction: 'The Genius', protocol: 'Uniswap V3' },
  { name: 'Cuban Linx Yield Cooperative', icon: '👻', chain: 'Polygon', faction: 'The Chef', protocol: 'Aave V3' },
  { name: 'Golden Arms Bridge Swarm', icon: '⚖️', chain: 'Optimism', faction: 'U-God', protocol: 'Balancer' },
  { name: 'Tical Flash Swarm', icon: '📊', chain: 'Base', faction: 'Meth Lab', protocol: 'Compound V3' },
];
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
  const block = await request('eth_blockNumber', [], signal);
  quantity(block);
  const blockInfo = await request('eth_getBlockByNumber', [block, false], signal) as { timestamp?: unknown; number?: unknown } | null;
  if (!blockInfo || blockInfo.number !== block) throw new Error('Block data is incomplete.');
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

export default function DeFiSwarmPanel() {
  const [wallet, setWallet] = useState('');
  const [running, setRunning] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState<string | null>('Aave V3');
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
  async function connectWallet() {
    try {
      const provider = (window as Window & { ethereum?: WalletProvider }).ethereum;
      if (!provider) throw new Error('No browser wallet is available here. Open the preview in your wallet browser, or enter your public address below.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !addressPattern.test(accounts[0])) throw new Error('The wallet did not provide an account.');
      stop(); setWallet(accounts[0]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Wallet connection was declined.'); }
  }
  const healthy = running && snapshot !== null && !error;
  const stats = [
    { label: 'Verified collateral', value: snapshot?.collateral ? `${snapshot.collateral} ${snapshot.currency}` : '—', icon: Boxes },
    { label: 'Yield 24h', value: '—', icon: DollarSign },
    { label: 'Yield 7d', value: '—', icon: DollarSign },
    { label: 'Verified APY', value: '—', icon: Percent },
    { label: 'Live monitors', value: healthy ? '1' : '—', icon: Bot },
    { label: 'Confirmed rebalances', value: '—', icon: Activity },
  ];
  return <section className="space-y-5">
    <div className="flex items-center gap-3 flex-wrap">
      <Network className="h-5 w-5 text-cyan-400" /><h2 className="text-lg font-bold text-zinc-100">DeFi Swarm Intelligence</h2>
      <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-[11px] font-bold text-cyan-400">{healthy ? 'ON-CHAIN MONITORING' : running ? 'CONNECTING' : 'NOT RUNNING'}</span>
    </div>
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Public wallet address" value={wallet} onChange={event => { stop(); setWallet(event.target.value); }} placeholder="Public wallet address (0x…)" className="min-w-64 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200" />
        <button onClick={() => void connectWallet()} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200"><Wallet className="mr-2 inline h-4 w-4" />Connect wallet</button>
        <button disabled={loading} onClick={() => { setSnapshot(null); setError(''); setRunning(true); setRefresh(value => value + 1); }} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white disabled:opacity-50">{loading ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Play className="mr-2 inline h-4 w-4" />}Run live checks</button>
        {running && <button onClick={stop} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"><Square className="mr-2 inline h-4 w-4" />Stop checks</button>}
      </div>
      <p className="text-xs text-zinc-500">Polygon mainnet · Aave V3 · reads every 30 seconds while this panel is open. A public address enables position checks. No private key is requested.</p>
      <p className="text-xs text-zinc-400">These checks monitor the chain and positions. Funded strategy execution and yield accounting are not connected.</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {snapshot && <p role="status" className="text-xs text-cyan-400">Verified block {snapshot.block} · checked {snapshot.checkedAt}{snapshot.wallet ? ` · wallet ${snapshot.wallet}` : ' · connect a wallet for positions'}</p>}
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{stats.map(stat => <div key={stat.label} className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4"><div className="mb-1.5 flex items-center gap-1.5"><stat.icon className="h-3.5 w-3.5 text-cyan-400" /><p className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</p></div><p className="font-mono text-xl font-bold text-zinc-100 break-all">{stat.value}</p></div>)}</div>
    <div className="space-y-3">{cards.map(card => {
      const aave = card.protocol === 'Aave V3';
      const open = expanded === card.protocol;
      return <div key={card.protocol} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
        <button aria-expanded={open} onClick={() => setExpanded(open ? null : card.protocol)} className="flex w-full items-center gap-4 p-5 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}<span className="text-2xl">{card.icon}</span>
          <div className="flex-1"><h3 className="text-sm font-bold text-zinc-200">{card.name}</h3><p className="text-[10px] text-zinc-500">{card.chain} · {card.faction} · {card.protocol}</p></div>
          <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] font-bold text-cyan-400">{aave ? healthy ? 'MONITORING' : error ? 'CONNECTION ERROR' : 'READY TO CHECK' : 'INTEGRATION REQUIRED'}</span>
          <div className="hidden text-right sm:block"><p className="text-[9px] text-zinc-500">COLLATERAL</p><p className="font-mono text-sm text-zinc-200">{aave && snapshot?.collateral ? `${snapshot.collateral} ${snapshot.currency}` : '—'}</p></div>
        </button>
        {open && <div className="space-y-3 border-t border-zinc-800 p-5 text-xs text-zinc-400">{aave ? <><p>Monitor checks the Polygon chain ID, block freshness, current Aave pool bytecode, wallet balance and Aave position at the same block.</p><div className="grid grid-cols-3 gap-4"><div>Wallet POL<p className="mt-1 font-mono text-zinc-200">{snapshot?.nativeBalance ?? '—'}</p></div><div>Debt<p className="mt-1 font-mono text-zinc-200">{snapshot?.debt ? `${snapshot.debt} ${snapshot.currency}` : '—'}</p></div><div>Health factor<p className="mt-1 font-mono text-zinc-200">{snapshot?.health ?? '—'}</p></div></div>{snapshot && <p className="break-all">Pool: {snapshot.pool}</p>}</> : <p>This strategy requires a protocol adapter, wallet position discovery and confirmed transaction accounting before it can run. No activity or earnings are estimated.</p>}</div>}
      </div>;
    })}</div>
  </section>;
}
