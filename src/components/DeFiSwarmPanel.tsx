import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HeartPulse,
  Network,
  Play,
  RefreshCw,
  Square,
  Wallet,
} from 'lucide-react';

const DEFAULT_WALLET = '0xb4d70fcFE953b9a563DD96Ee59D17082Db253098';
const AAVE_PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const POLYGON_CHAIN_ID = 137n;
const POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 7_000;
const RPC_ENDPOINTS = [
  'https://gateway.tenderly.co/public/polygon',
  'https://api.zan.top/polygon-mainnet',
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon-rpc.com',
  'https://1rpc.io/matic',
  'https://polygon.drpc.org',
  'https://polygon.api.onfinality.io/public',
];
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type Rpc = (method: string, params: unknown[], signal: AbortSignal) => Promise<unknown>;
type Snapshot = {
  block: string;
  blockTime: number;
  checkedAt: string;
  pool: string;
  wallet: string;
  nativeBalance: string;
  collateral: string;
  debt: string;
  health: string;
  currency: string;
  source: string;
};
type EngineSnapshot = {
  block: string;
  blockTime: number;
  checkedAt: string;
  contract: string;
  nativeBalance: string;
  source: string;
};
type EngineConfig = {
  name: string;
  icon: string;
  chain: string;
  faction: string;
  protocol: string;
  chainId: bigint;
  nativeSymbol: string;
  contract: string;
  contractLabel: string;
  endpoints: string[];
};

const protocolCards: EngineConfig[] = [
  {
    name: 'Cuban Linx Yield Cooperative', icon: '🏦', chain: 'Polygon', faction: 'The Chef', protocol: 'Aave V3',
    chainId: 137n, nativeSymbol: 'POL', contract: AAVE_PROVIDER, contractLabel: 'PoolAddressesProvider', endpoints: RPC_ENDPOINTS,
  },
  {
    name: 'Liquid Swords Swarm', icon: '🦄', chain: 'Arbitrum', faction: 'The Genius', protocol: 'Uniswap V3',
    chainId: 42161n, nativeSymbol: 'ETH', contract: '0x1F98431c8aD98523631AE4a59f267346ea31F984', contractLabel: 'V3 Factory',
    endpoints: ['https://gateway.tenderly.co/public/arbitrum', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  },
  {
    name: 'Supreme Clientele Pool', icon: '🌊', chain: 'Ethereum', faction: 'Tony Starks', protocol: 'Curve',
    chainId: 1n, nativeSymbol: 'ETH', contract: '0x0000000022D53366457F9d5E68Ec105046FC4383', contractLabel: 'Address Provider',
    endpoints: ['https://gateway.tenderly.co/public/mainnet', 'https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'],
  },
  {
    name: 'Golden Arms Bridge Swarm', icon: '⚖️', chain: 'Optimism', faction: 'U-God', protocol: 'Balancer',
    chainId: 10n, nativeSymbol: 'ETH', contract: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', contractLabel: 'Vault',
    endpoints: ['https://gateway.tenderly.co/public/optimism', 'https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  },
  {
    name: 'Tical Flash Swarm', icon: '📊', chain: 'Base', faction: 'Meth Lab', protocol: 'Compound V3',
    chainId: 8453n, nativeSymbol: 'ETH', contract: '0xb125E6687d4313864e53df431d5425969c15Eb2F', contractLabel: 'cUSDCv3 Comet',
    endpoints: ['https://gateway.tenderly.co/public/base', 'https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  },
];

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error('The RPC returned an invalid hexadecimal value.');
  }
  return BigInt(value);
}

function decimal(value: bigint, scale: bigint, places = 6): string {
  if (scale <= 0n) throw new Error('Aave returned an invalid currency unit.');
  const fraction = ((value % scale) * 10n ** BigInt(places) / scale)
    .toString()
    .padStart(places, '0')
    .replace(/0+$/, '');
  return `${value / scale}${fraction ? `.${fraction}` : ''}`;
}

function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(value)) {
    throw new Error('Aave returned an invalid contract address.');
  }
  const address = `0x${value.slice(-40)}`;
  if (/^0x0{40}$/i.test(address)) throw new Error('The requested Aave contract is not configured.');
  return address;
}

function validateWallet(wallet: string): string {
  const normalized = wallet.trim();
  if (!addressPattern.test(normalized) || /^0x0{40}$/i.test(normalized)) {
    throw new Error('Enter a valid, nonzero EVM wallet address.');
  }
  return normalized;
}

async function endpointRpc(endpoint: string, method: string, params: unknown[], outerSignal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outerSignal.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { id?: unknown; result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message || 'RPC request rejected');
    if (body.id !== 1 || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      throw new Error('Malformed JSON-RPC response');
    }
    return body.result;
  } finally {
    window.clearTimeout(timeout);
    outerSignal.removeEventListener('abort', abort);
  }
}

function injectedRpc(provider: WalletProvider): Rpc {
  return async (method, params, signal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return provider.request({ method, params });
  };
}

async function readSnapshot(request: Rpc, wallet: string, source: string, signal: AbortSignal): Promise<Snapshot> {
  if (quantity(await request('eth_chainId', [], signal)) !== POLYGON_CHAIN_ID) {
    throw new Error('This provider is not connected to Polygon mainnet.');
  }

  const blockInfo = await request('eth_getBlockByNumber', ['latest', false], signal) as {
    timestamp?: unknown;
    number?: unknown;
  } | null;
  if (!blockInfo) throw new Error('The provider did not return a Polygon block.');
  const block = blockInfo.number;
  const blockNumber = quantity(block);
  const blockTime = Number(quantity(blockInfo.timestamp)) * 1000;
  if (Date.now() - blockTime > 180_000 || blockTime - Date.now() > 30_000) {
    throw new Error('The provider returned a stale Polygon block.');
  }

  const call = (to: string, data: string) => request('eth_call', [{ to, data }, block], signal);
  const pool = decodeAddress(await call(AAVE_PROVIDER, '0x026b1d5f'));
  const code = await request('eth_getCode', [pool, block], signal);
  if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || code === '0x0') {
    throw new Error('The current Aave V3 pool contract could not be verified.');
  }

  const oracle = decodeAddress(await call(AAVE_PROVIDER, '0xfca513a8'));
  const [account, balance, unit, base] = await Promise.all([
    call(pool, `0xbf92857c${wallet.slice(2).toLowerCase().padStart(64, '0')}`),
    request('eth_getBalance', [wallet, block], signal),
    call(oracle, '0x8c89b64f'),
    call(oracle, '0xe19f4700'),
  ]);
  if (typeof account !== 'string' || !/^0x[0-9a-f]{384}$/i.test(account)) {
    throw new Error('Aave returned an invalid account snapshot.');
  }
  if (typeof base !== 'string' || !/^0x[0-9a-f]{64}$/i.test(base)) {
    throw new Error('Aave returned an invalid oracle currency.');
  }

  const values = Array.from({ length: 6 }, (_, index) =>
    BigInt(`0x${account.slice(2 + index * 64, 66 + index * 64)}`),
  );
  const currency = quantity(base) === 0n ? 'USD' : decodeAddress(base);
  return {
    block: blockNumber.toString(),
    blockTime,
    checkedAt: new Date().toISOString(),
    pool,
    wallet,
    nativeBalance: decimal(quantity(balance), 10n ** 18n),
    collateral: decimal(values[0], quantity(unit), 2),
    debt: decimal(values[1], quantity(unit), 2),
    health: values[1] === 0n ? 'No debt' : decimal(values[5], 10n ** 18n, 4),
    currency,
    source,
  };
}

async function readWithFailover(wallet: string, signal: AbortSignal, provider: WalletProvider | null): Promise<Snapshot> {
  const failures: string[] = [];
  if (provider) {
    try {
      return await readSnapshot(injectedRpc(provider), wallet, 'Connected wallet', signal);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Connected wallet failed');
    }
  }

  for (const endpoint of RPC_ENDPOINTS) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const request: Rpc = (method, params, requestSignal) => endpointRpc(endpoint, method, params, requestSignal);
      return await readSnapshot(request, wallet, new URL(endpoint).host, signal);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Unknown RPC failure');
    }
  }
  const reason = failures[failures.length - 1] || 'No provider responded';
  throw new Error(`Polygon providers are unavailable. Last response: ${reason}`);
}

async function readEngine(request: Rpc, config: EngineConfig, wallet: string, source: string, signal: AbortSignal): Promise<EngineSnapshot> {
  if (quantity(await request('eth_chainId', [], signal)) !== config.chainId) {
    throw new Error(`Wrong chain returned for ${config.chain}.`);
  }
  const blockInfo = await request('eth_getBlockByNumber', ['latest', false], signal) as {
    timestamp?: unknown;
    number?: unknown;
  } | null;
  if (!blockInfo) throw new Error(`${config.chain} did not return a block.`);
  const block = blockInfo.number;
  const blockNumber = quantity(block);
  const blockTime = Number(quantity(blockInfo.timestamp)) * 1000;
  if (Date.now() - blockTime > 300_000 || blockTime - Date.now() > 30_000) {
    throw new Error(`${config.chain} returned a stale block.`);
  }
  const [code, balance] = await Promise.all([
    request('eth_getCode', [config.contract, block], signal),
    request('eth_getBalance', [wallet, block], signal),
  ]);
  if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || code === '0x0') {
    throw new Error(`${config.protocol} ${config.contractLabel} could not be verified.`);
  }
  return {
    block: blockNumber.toString(),
    blockTime,
    checkedAt: new Date().toISOString(),
    contract: config.contract,
    nativeBalance: decimal(quantity(balance), 10n ** 18n),
    source,
  };
}

async function readEngineWithFailover(config: EngineConfig, wallet: string, signal: AbortSignal): Promise<EngineSnapshot> {
  const failures: string[] = [];
  for (const endpoint of config.endpoints) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const request: Rpc = (method, params, requestSignal) => endpointRpc(endpoint, method, params, requestSignal);
      return await readEngine(request, config, wallet, new URL(endpoint).host, signal);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Unknown RPC failure');
    }
  }
  const reason = failures[failures.length - 1] || 'No provider responded';
  throw new Error(`${config.protocol} is unavailable. Last response: ${reason}`);
}

export default function DeFiSwarmPanel() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [running, setRunning] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [engineSnapshots, setEngineSnapshots] = useState<Record<string, EngineSnapshot>>({});
  const [engineErrors, setEngineErrors] = useState<Record<string, string>>({});
  const [engineLoading, setEngineLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>('Aave V3');
  const providerRef = useRef<WalletProvider | null>(null);

  const stop = useCallback(() => {
    setRunning(false);
    setLoading(false);
    setEngineLoading(false);
    setError('');
  }, []);

  const run = useCallback(() => {
    try {
      const normalized = validateWallet(wallet);
      setWallet(normalized);
      localStorage.setItem('defi-monitor-wallet', normalized);
      setError('');
      setRunning(true);
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The wallet address is invalid.');
    }
  }, [wallet]);

  const connectWallet = useCallback(async () => {
    try {
      const provider = (window as Window & { ethereum?: WalletProvider }).ethereum;
      if (!provider) throw new Error('No browser wallet was found. Paste a public address instead.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
        throw new Error('The wallet did not return an account.');
      }
      const account = validateWallet(accounts[0]);
      providerRef.current = provider;
      setWallet(account);
      localStorage.setItem('defi-monitor-wallet', account);
      setError('');
      setRunning(true);
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet connection was declined.');
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      setLoading(true);
      try {
        const next = await readWithFailover(validateWallet(wallet), controller.signal, providerRef.current);
        if (!disposed) {
          setSnapshot(next);
          setError('');
        }
      } catch (cause) {
        if (!disposed && (!(cause instanceof DOMException) || cause.name !== 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'The on-chain check failed.');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [running, wallet, refresh]);

  useEffect(() => {
    if (!running) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const pollEngines = async () => {
      controller = new AbortController();
      setEngineLoading(true);
      const configs = protocolCards.slice(1);
      const results = await Promise.allSettled(
        configs.map(config => readEngineWithFailover(config, validateWallet(wallet), controller!.signal)),
      );
      if (!disposed) {
        const successes: Record<string, EngineSnapshot> = {};
        const failures: Record<string, string> = {};
        results.forEach((result, index) => {
          const protocol = configs[index].protocol;
          if (result.status === 'fulfilled') successes[protocol] = result.value;
          else if (!(result.reason instanceof DOMException) || result.reason.name !== 'AbortError') {
            failures[protocol] = result.reason instanceof Error ? result.reason.message : `${protocol} check failed.`;
          }
        });
        setEngineSnapshots(previous => ({ ...previous, ...successes }));
        setEngineErrors(failures);
        setEngineLoading(false);
        timer = setTimeout(() => void pollEngines(), POLL_INTERVAL_MS);
      }
    };

    void pollEngines();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [running, wallet, refresh]);

  const fresh = snapshot !== null && Date.now() - snapshot.blockTime <= 180_000;
  const healthy = running && fresh && !error;
  const genericLiveCount = protocolCards.slice(1).filter(card => {
    const engine = engineSnapshots[card.protocol];
    return running && engine && Date.now() - engine.blockTime <= 300_000 && !engineErrors[card.protocol];
  }).length;
  const liveCount = (healthy ? 1 : 0) + genericLiveCount;
  const allHealthy = liveCount === protocolCards.length;
  const checking = loading || engineLoading;
  const status = allHealthy ? 'ALL SWARMS LIVE' : checking ? `CONNECTING ${liveCount}/${protocolCards.length}` : running ? `${liveCount}/${protocolCards.length} SWARMS LIVE` : 'PAUSED';
  const explorer = `https://polygonscan.com/address/${addressPattern.test(wallet.trim()) ? wallet.trim() : DEFAULT_WALLET}`;
  const stats = [
    { label: 'POL balance', value: snapshot?.nativeBalance ?? '—', icon: Wallet },
    { label: 'Collateral', value: snapshot ? `${snapshot.collateral} ${snapshot.currency}` : '—', icon: Boxes },
    { label: 'Debt', value: snapshot ? `${snapshot.debt} ${snapshot.currency}` : '—', icon: Activity },
    { label: 'Health factor', value: snapshot?.health ?? '—', icon: HeartPulse },
    { label: 'Verified block', value: snapshot?.block ?? '—', icon: Network },
    { label: 'Live monitors', value: `${liveCount}/${protocolCards.length}`, icon: Bot },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Network className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-zinc-100">DeFi Swarm Intelligence</h2>
        <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${allHealthy ? 'bg-emerald-500/15 text-emerald-400' : liveCount > 0 ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300'}`}>
          {status}
        </span>
        <a href={explorer} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
          <ExternalLink className="h-3.5 w-3.5" /> PolygonScan
        </a>
      </div>

      <div className="space-y-3 rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-zinc-950 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Public wallet address"
            value={wallet}
            onChange={event => { stop(); setWallet(event.target.value); }}
            onKeyDown={event => { if (event.key === 'Enter') run(); }}
            spellCheck={false}
            placeholder="Public wallet address (0x…)"
            className="min-w-64 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 outline-none focus:border-cyan-600"
          />
          <button onClick={() => void connectWallet()} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700">
            <Wallet className="mr-2 inline h-4 w-4" />Connect wallet
          </button>
          <button disabled={checking} onClick={run} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500 disabled:opacity-50">
            {checking ? <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> : <Play className="mr-2 inline h-4 w-4" />}Run all engines
          </button>
          {running && <button onClick={stop} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"><Square className="mr-2 inline h-4 w-4" />Pause</button>}
        </div>
        <p className="text-xs text-zinc-500">Connected read-only to <span className="font-mono text-cyan-400">{wallet}</span>. Every 30 seconds the swarm verifies fresh blocks, canonical protocol contracts, and wallet balances across Polygon, Arbitrum, Ethereum, Optimism, and Base. Aave also verifies collateral, debt, and health factor. No private key is requested.</p>
        {snapshot && <p role="status" className="text-xs text-cyan-400">{liveCount}/{protocolCards.length} engines verified · Aave checked at {new Date(snapshot.checkedAt).toLocaleTimeString()} via {snapshot.source} · pool {snapshot.pool.slice(0, 8)}…{snapshot.pool.slice(-6)}</p>}
        {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300"><span>{error}{snapshot ? ' Showing the last verified snapshot.' : ''}</span><button onClick={run} className="flex-shrink-0 text-xs font-bold text-red-200 underline">Retry</button></div>}
        {Object.keys(engineErrors).length > 0 && <div role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">{Object.entries(engineErrors).map(([protocol, message]) => <p key={protocol}><span className="font-bold">{protocol}:</span> {message}</p>)}</div>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(stat => <div key={stat.label} className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4"><div className="mb-1.5 flex items-center gap-1.5"><stat.icon className="h-3.5 w-3.5 text-cyan-400" /><p className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</p></div><p className="break-all font-mono text-xl font-bold text-zinc-100">{stat.value}</p></div>)}
      </div>

      <div className="space-y-3">
        {protocolCards.map(card => {
          const open = expanded === card.protocol;
          const isAave = card.protocol === 'Aave V3';
          const engine = engineSnapshots[card.protocol];
          const cardLive = isAave
            ? healthy
            : Boolean(running && engine && Date.now() - engine.blockTime <= 300_000 && !engineErrors[card.protocol]);
          const cardStatus = cardLive ? 'VERIFIED LIVE' : checking ? 'CONNECTING' : engineErrors[card.protocol] ? 'UNAVAILABLE' : 'READY';
          const cardValue = isAave && snapshot
            ? `${snapshot.collateral} ${snapshot.currency}`
            : engine ? `${engine.nativeBalance} ${card.nativeSymbol}` : '—';
          return <div key={card.protocol} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
            <button aria-expanded={open} onClick={() => setExpanded(open ? null : card.protocol)} className="flex w-full items-center gap-4 p-5 text-left">
              {open ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
              <span className="text-2xl">{card.icon}</span>
              <div className="flex-1"><h3 className="text-sm font-bold text-zinc-200">{card.name}</h3><p className="text-[10px] text-zinc-500">{card.chain} · {card.faction} · {card.protocol}</p></div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${cardLive ? 'bg-emerald-500/15 text-emerald-400' : engineErrors[card.protocol] ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>{cardStatus}</span>
              <div className="hidden text-right sm:block"><p className="text-[9px] text-zinc-500">{isAave ? 'COLLATERAL' : `${card.nativeSymbol} BALANCE`}</p><p className="font-mono text-sm text-zinc-200">{cardValue}</p></div>
            </button>
            {open && <div className="space-y-3 border-t border-zinc-800 p-5 text-xs text-zinc-400">{isAave ? <><p>This engine resolves the current Aave Pool and Price Oracle from the canonical provider at the same verified block as the wallet snapshot.</p><div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><div>Wallet POL<p className="mt-1 font-mono text-zinc-200">{snapshot?.nativeBalance ?? '—'}</p></div><div>Debt<p className="mt-1 font-mono text-zinc-200">{snapshot ? `${snapshot.debt} ${snapshot.currency}` : '—'}</p></div><div>Health factor<p className="mt-1 font-mono text-zinc-200">{snapshot?.health ?? '—'}</p></div></div>{snapshot && <p className="break-all text-zinc-500">Pool: {snapshot.pool} · Block: {snapshot.block} · RPC: {snapshot.source}</p>}</> : <><p>This engine verifies the {card.protocol} {card.contractLabel} bytecode, a fresh {card.chain} block, and the connected wallet balance.</p><div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><div>Wallet {card.nativeSymbol}<p className="mt-1 font-mono text-zinc-200">{engine?.nativeBalance ?? '—'}</p></div><div>Verified block<p className="mt-1 font-mono text-zinc-200">{engine?.block ?? '—'}</p></div><div>RPC source<p className="mt-1 font-mono text-zinc-200">{engine?.source ?? '—'}</p></div></div><p className="break-all text-zinc-500">{card.contractLabel}: {card.contract}</p>{engineErrors[card.protocol] && <p className="text-red-300">{engineErrors[card.protocol]}</p>}</>}</div>}
          </div>;
        })}
      </div>
    </section>
  );
}
