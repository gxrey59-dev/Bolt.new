import { useEffect, useRef, useState } from 'react';
import {
  Network,
  Bot,
  Boxes,
  DollarSign,
  Percent,
  Activity,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Wallet,
  Square,
  Play,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Live-verified Polygon Aave V3 connectors (tested 2026-10-06)
// ---------------------------------------------------------------------------
const PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';
const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://rpc-mainnet.matic.quiknode.pro',
] as const;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_WALLET = '0xb4d70fcfe953b9a563dd96ee59d17082db253098';

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

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const cards = [
  { name: 'Supreme Clientele Pool', icon: '🌊', chain: 'Ethereum', faction: 'Tony Starks', protocol: 'Curve' },
  { name: 'Liquid Swords Swarm', icon: '🦄', chain: 'Arbitrum', faction: 'The Genius', protocol: 'Uniswap V3' },
  { name: 'Cuban Linx Yield Cooperative', icon: '👻', chain: 'Polygon', faction: 'The Chef', protocol: 'Aave V3' },
  { name: 'Golden Arms Bridge Swarm', icon: '⚖️', chain: 'Optimism', faction: 'U-God', protocol: 'Balancer' },
  { name: 'Tical Flash Swarm', icon: '📊', chain: 'Base', faction: 'Meth Lab', protocol: 'Compound V3' },
];

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error('Invalid hexadecimal RPC response.');
  }
  return BigInt(value);
}

function decimal(value: bigint, scale: bigint, places = 6): string {
  if (scale <= 0n) throw new Error('Invalid oracle unit.');
  const whole = value / scale;
  const frac = ((value % scale) * 10n ** BigInt(places)) / scale;
  const fracStr = frac.toString().padStart(places, '0').replace(/0+$/, '');
  return whole.toString() + (fracStr ? '.' + fracStr : '');
}

function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Invalid contract address response.');
  }
  const address = '0x' + value.slice(-40);
  if (/^0x0{40}$/i.test(address)) throw new Error('Contract address is not configured.');
  return address;
}

async function rpcCall(
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  let lastError: Error = new Error('All Polygon RPCs failed.');
  for (const endpoint of RPCS) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
      });
      if (!response.ok) {
        lastError = new Error(`RPC HTTP ${response.status} from ${endpoint}`);
        continue;
      }
      const body = (await response.json()) as {
        error?: { message?: string };
        id?: number;
        result?: unknown;
      };
      if (body.error) {
        lastError = new Error(body.error.message || 'RPC rejected request');
        continue;
      }
      if (body.id !== 1 || !('result' in body)) {
        lastError = new Error('Malformed RPC response');
        continue;
      }
      return body.result;
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

async function readSnapshot(wallet: string, signal: AbortSignal): Promise<Snapshot> {
  const trimmed = wallet.trim();
  if (trimmed && (!addressPattern.test(trimmed) || /^0x0{40}$/i.test(trimmed))) {
    throw new Error('Enter a valid nonzero public wallet address (0x + 40 hex).');
  }

  const chainId = await rpcCall('eth_chainId', [], signal);
  if (quantity(chainId) !== 137n) {
    throw new Error('Wrong network — Polygon mainnet (chainId 137) required.');
  }

  const blockInfo = (await rpcCall('eth_getBlockByNumber', ['latest', false], signal)) as {
    number?: unknown;
    timestamp?: unknown;
  } | null;
  if (!blockInfo?.number || blockInfo.timestamp === undefined) {
    throw new Error('RPC returned no block header.');
  }

  const blockHex = blockInfo.number;
  quantity(blockHex);
  const blockTime = Number(quantity(blockInfo.timestamp)) * 1000;
  const age = Date.now() - blockTime;
  if (age > 180_000 || age < -30_000) {
    throw new Error('RPC block timestamp is stale or skewed.');
  }

  const call = (to: string, data: string) =>
    rpcCall('eth_call', [{ to, data }, blockHex], signal);

  const pool = decodeAddress(await call(PROVIDER, '0x026b1d5f'));
  const code = await rpcCall('eth_getCode', [pool, blockHex], signal);
  if (typeof code !== 'string' || code === '0x' || code === '0x0') {
    throw new Error('Aave pool has no bytecode at this block.');
  }

  const result: Snapshot = {
    block: quantity(blockHex).toString(),
    blockTime,
    checkedAt: new Date().toISOString(),
    pool,
    wallet: trimmed || null,
    nativeBalance: null,
    collateral: null,
    debt: null,
    health: null,
    currency: '',
  };

  if (!trimmed) return result;

  const oracle = decodeAddress(await call(PROVIDER, '0xfca513a8'));
  const accountData =
    '0xbf92857c' + trimmed.slice(2).toLowerCase().padStart(64, '0');

  const [account, balance, unit, base] = await Promise.all([
    call(pool, accountData),
    rpcCall('eth_getBalance', [trimmed, blockHex], signal),
    call(oracle, '0x8c89b64f'),
    call(oracle, '0xe19f4700'),
  ]);

  if (typeof account !== 'string' || !/^0x[0-9a-f]{384}$/i.test(account)) {
    throw new Error('Aave returned an unexpected account snapshot shape.');
  }

  const words = Array.from({ length: 6 }, (_, i) =>
    BigInt('0x' + account.slice(2 + i * 64, 2 + (i + 1) * 64)),
  );

  const unitBn = quantity(unit);
  result.currency =
    typeof base === 'string' && quantity(base) === 0n ? 'USD' : decodeAddress(base);

  result.nativeBalance = decimal(quantity(balance), 10n ** 18n, 6);
  result.collateral = decimal(words[0], unitBn, 2);
  result.debt = decimal(words[1], unitBn, 2);
  result.health =
    words[1] === 0n ? 'No debt' : decimal(words[5], 10n ** 18n, 4);

  return result;
}

export default function DeFiSwarmPanel() {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [walletMsg, setWalletMsg] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState<string | null>('Aave V3');

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;

    if (!running) {
      return () => {
        disposedRef.current = true;
      };
    }

    async function poll() {
      if (disposedRef.current) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);

      try {
        const next = await readSnapshot(wallet, controller.signal);
        if (!disposedRef.current && !controller.signal.aborted) {
          setSnapshot(next);
          setError('');
        }
      } catch (cause) {
        if (disposedRef.current || controller.signal.aborted) return;
        if ((cause as Error)?.name === 'AbortError') return;
        const msg = cause instanceof Error ? cause.message : 'Live check failed.';
        setSnapshot(null);
        setError(msg);
      } finally {
        if (!disposedRef.current) setLoading(false);
        if (!disposedRef.current && running) {
          timerRef.current = setTimeout(() => void poll(), 30_000);
        }
      }
    }

    void poll();

    return () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [running, wallet, tick]);

  function stop() {
    setRunning(false);
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    setSnapshot(null);
    setLoading(false);
    setError('');
  }

  function start() {
    setError('');
    setWalletMsg('');
    setSnapshot(null);
    setRunning(true);
    setTick((n: number) => n + 1);
  }

  async function connectWallet() {
    setWalletMsg('');
    try {
      const eth = (window as Window & { ethereum?: WalletProvider }).ethereum;
      if (!eth) {
        setWalletMsg(
          'No browser wallet in this preview. The public address below is used for read-only checks — no private key needed.',
        );
        return;
      }
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== 'string' ||
        !addressPattern.test(accounts[0])
      ) {
        setWalletMsg('Wallet returned no valid account.');
        return;
      }
      setWallet(accounts[0]);
      setWalletMsg('');
      setError('');
      setRunning(true);
      setTick((n: number) => n + 1);
    } catch (cause) {
      setWalletMsg(
        cause instanceof Error ? cause.message : 'Wallet connection declined.',
      );
    }
  }

  const healthy = running && snapshot !== null && !error;

  const stats = [
    {
      label: 'Verified collateral',
      value: snapshot?.collateral
        ? `${snapshot.collateral} ${snapshot.currency}`
        : '—',
      icon: Boxes,
    },
    { label: 'Yield 24h', value: '—', icon: DollarSign },
    { label: 'Yield 7d', value: '—', icon: DollarSign },
    { label: 'Verified APY', value: '—', icon: Percent },
    { label: 'Live monitors', value: healthy ? '1' : '—', icon: Bot },
    { label: 'Confirmed rebalances', value: '—', icon: Activity },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Network className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-zinc-100">DeFi Swarm Intelligence</h2>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-bold ${
            healthy
              ? 'bg-emerald-500/15 text-emerald-400'
              : error
                ? 'bg-red-500/15 text-red-400'
                : running
                  ? 'bg-cyan-500/15 text-cyan-400'
                  : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {healthy
            ? 'ON-CHAIN MONITORING'
            : error
              ? 'CONNECTION ERROR'
              : running
                ? 'CONNECTING'
                : 'NOT RUNNING'}
        </span>
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Public wallet address"
            value={wallet}
            onChange={(e) => {
              stop();
              setWallet(e.target.value);
              setWalletMsg('');
            }}
            placeholder="Public wallet address (0x…)"
            className="min-w-64 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void connectWallet()}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            <Wallet className="mr-2 inline h-4 w-4" />
            Connect wallet
          </button>
          <button
            type="button"
            disabled={loading && running}
            onClick={() => (running ? stop() : start())}
            className={`rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50 ${
              running
                ? 'bg-red-600/80 hover:bg-red-600'
                : 'bg-cyan-600 hover:bg-cyan-500'
            }`}
          >
            {running ? (
              <>
                <Square className="mr-2 inline h-4 w-4" />
                Stop
              </>
            ) : loading ? (
              <>
                <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <Play className="mr-2 inline h-4 w-4" />
                Run live checks
              </>
            )}
          </button>
          {running && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setTick((n: number) => n + 1)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              <RefreshCw
                className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          Polygon mainnet · Aave V3 · polls every 30 s while open. Public address only —
          no private key is ever requested or stored.
        </p>
        <p className="text-xs text-zinc-500">
          These checks read on-chain state only. Funded execution and yield accounting are
          not connected.
        </p>

        {walletMsg && <p className="text-sm text-amber-400">{walletMsg}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {healthy && snapshot && (
          <p className="text-xs text-emerald-500/80">
            Last check {new Date(snapshot.checkedAt).toLocaleTimeString()} · block{' '}
            {snapshot.block} · pool {snapshot.pool.slice(0, 10)}…
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 p-4"
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <stat.icon className="h-3.5 w-3.5 text-cyan-400" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                {stat.label}
              </p>
            </div>
            <p className="break-all font-mono text-xl font-bold text-zinc-100">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {cards.map((card) => {
          const aave = card.protocol === 'Aave V3';
          const open = expanded === card.protocol;
          return (
            <div
              key={card.protocol}
              className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : card.protocol)}
                className="flex w-full items-center gap-4 p-5 text-left"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <span className="text-2xl">{card.icon}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-zinc-200">{card.name}</h3>
                  <p className="text-[10px] text-zinc-500">
                    {card.chain} · {card.faction} · {card.protocol}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-1 text-[10px] font-bold text-cyan-400">
                  {aave
                    ? healthy
                      ? 'MONITORING'
                      : error
                        ? 'CONNECTION ERROR'
                        : running
                          ? 'CHECKING'
                          : 'READY'
                    : 'INTEGRATION REQUIRED'}
                </span>
                <div className="hidden shrink-0 text-right sm:block">
                  <p className="text-[9px] text-zinc-500">COLLATERAL</p>
                  <p className="font-mono text-sm text-zinc-200">
                    {aave && snapshot?.collateral
                      ? `${snapshot.collateral} ${snapshot.currency}`
                      : '—'}
                  </p>
                </div>
              </button>

              {open && (
                <div className="space-y-3 border-t border-zinc-800 p-5 text-xs text-zinc-400">
                  {aave ? (
                    <>
                      <p>
                        Live read of Polygon chain ID, block freshness, Aave pool bytecode,
                        wallet POL balance and Aave V3 position at the same block. Locked
                        address:{' '}
                        <span className="font-mono text-zinc-300">{DEFAULT_WALLET}</span>
                      </p>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          Wallet POL
                          <p className="mt-1 font-mono text-zinc-200">
                            {snapshot?.nativeBalance ?? '—'}
                          </p>
                        </div>
                        <div>
                          Debt
                          <p className="mt-1 font-mono text-zinc-200">
                            {snapshot?.debt
                              ? `${snapshot.debt} ${snapshot.currency}`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          Health factor
                          <p className="mt-1 font-mono text-zinc-200">
                            {snapshot?.health ?? '—'}
                          </p>
                        </div>
                      </div>
                      {snapshot && (
                        <p className="break-all text-[11px] text-zinc-500">
                          Pool: {snapshot.pool} · Block: {snapshot.block}
                        </p>
                      )}
                    </>
                  ) : (
                    <p>
                      This strategy requires a protocol adapter, wallet position discovery
                      and confirmed transaction accounting before it can run. No activity
                      or earnings are estimated.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
