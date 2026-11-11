import { useCallback, useRef, useState } from 'react';
import { Activity, AlertTriangle, Download, RefreshCw, Wallet, Zap } from 'lucide-react';
import ExecutionOrdersTable from '@/components/ExecutionOrdersTable';
import PairAllowlistPanel from '@/components/PairAllowlistPanel';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { buildExecutionOrders } from '@/lib/executionOrders';
import { buildExecutionCsv, downloadCsv } from '@/lib/executionCsv';
import { summarizeExecution, isSnapshotStale, type ExchangeBalance, type ReconciliationCandidate } from '@/lib/executionHealth';
import { runStrategyScan } from '@/lib/engine';
import type { BinanceOrder, SymbolHistory } from '@/lib/tradePnl';

interface OverviewResponse {
  ok: true;
  balances: ExchangeBalance[];
  canTrade: boolean;
  symbols: string[];
  omittedSymbols: string[];
  openOrders: (BinanceOrder & { symbol: string })[] | null;
  reconciliationCandidates: ReconciliationCandidate[];
  reconciliationChecked: boolean;
  warnings: string[];
  fetchedAt: string;
}
interface OrdersResponse {
  ok: true;
  symbols: SymbolHistory[];
  errors: { symbol: string; error: string }[];
  fetchedAt: string;
}
interface Snapshot { overview: OverviewResponse; histories: SymbolHistory[]; factions: Map<string, string>; warnings: string[] }

const TRADE_EVENT_PATTERN = /^LIVE: (\S+) (?:opened|closed) (?:LONG|SHORT) on (\S+) .*\[Order: (\d+)\]/;
const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = (value: string) => new Date(value).toLocaleString();

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Exchange connection returned HTTP ${res.status}.`);
  return data as T;
}

async function fetchFactionByOrderId(): Promise<Map<string, string>> {
  if (!hasDatabaseAccess) return new Map();
  const { data, error } = await supabase.from('audit_log').select('message')
    .in('event_type', ['live_trade_open', 'live_trade_close']).order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error('Faction labels are unavailable. Exchange balances are unaffected.');
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const match = TRADE_EVENT_PATTERN.exec(row.message);
    if (match) {
      const key = `${match[2]}:${match[3]}`;
      if (!map.has(key)) map.set(key, match[1].charAt(0).toUpperCase() + match[1].slice(1));
    }
  }
  return map;
}

export default function LiveExecutionDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const overview = await operatorFetch('binance-account/overview', { signal: AbortSignal.timeout(30_000) }).then(readJson<OverviewResponse>);
      if (!Array.isArray(overview.balances) || !Array.isArray(overview.symbols) || !Array.isArray(overview.reconciliationCandidates)
        || (overview.openOrders !== null && !Array.isArray(overview.openOrders)) || !Number.isFinite(Date.parse(overview.fetchedAt))) {
        throw new Error('Exchange overview was incomplete. Refresh or check the deployed account service.');
      }
      const warnings = [...(overview.warnings ?? [])];
      const histories: SymbolHistory[] = [];
      const batches: string[][] = [];
      for (let index = 0; index < overview.symbols.length; index += 5) batches.push(overview.symbols.slice(index, index + 5));
      // Two requests at a time, with two symbols per backend batch, limits exchange load.
      for (let index = 0; index < batches.length; index += 2) {
        const results = await Promise.allSettled(batches.slice(index, index + 2).map(async symbols => {
          const response = await operatorFetch(`binance-account/orders?symbols=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(45_000) }).then(readJson<OrdersResponse>);
          if (!Array.isArray(response.symbols) || !Array.isArray(response.errors)) throw new Error('Order history response was incomplete.');
          return response;
        }));
        for (const [offset, result] of results.entries()) {
          if (result.status === 'fulfilled') {
            histories.push(...result.value.symbols);
            warnings.push(...result.value.errors.map(item => `${item.symbol}: ${item.error}`));
          } else {
            warnings.push(`History unavailable for ${batches[index + offset].join(', ')}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`);
          }
        }
      }
      if (overview.omittedSymbols?.length) warnings.push(`History limit reached. ${overview.omittedSymbols.length} additional pairs have not been loaded.`);
      // Open orders can predate the latest 50 historical orders; retain them in the table.
      for (const order of overview.openOrders ?? []) {
        const history = histories.find(item => item.symbol === order.symbol);
        if (history && !history.orders.some(item => item.orderId === order.orderId)) history.orders.push(order);
      }
      let factions = new Map<string, string>();
      try { factions = await fetchFactionByOrderId(); } catch (cause) { warnings.push(cause instanceof Error ? cause.message : 'Faction labels unavailable.'); }
      setSnapshot({ overview, histories, factions, warnings });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Exchange data is unavailable.');
    } finally {
      busy.current = false;
      setLoading(false);
      setClock(Date.now());
    }
  }, []);

  useVisibilityPolling(refresh, 90_000);
  useVisibilityPolling(() => setClock(Date.now()), 10_000);

  const overview = snapshot?.overview;
  const orders = snapshot ? buildExecutionOrders(snapshot.histories, snapshot.factions) : [];
  const summary = summarizeExecution(orders);
  const stale = !!error || isSnapshotStale(overview?.fetchedAt ?? null, clock, 120_000);
  const usdt = overview?.balances.find(balance => balance.asset === 'USDT');
  const holdings = overview?.balances.filter(balance => balance.asset !== 'USDT') ?? [];
  const historyIncomplete = !!snapshot && (snapshot.histories.length < snapshot.overview.symbols.length || snapshot.overview.omittedSymbols.length > 0);
  const pnlAvailable = !!snapshot && snapshot.histories.length > 0 && (summary.incompleteSells === 0 || summary.matchedSells > 0);

  function exportCsv() {
    if (!snapshot || stale) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadCsv(`live-execution-${stamp}.csv`, buildExecutionCsv(overview!.balances, orders, snapshot.histories, new Date().toISOString()));
  }

  async function handleScanNow() {
    if (!window.confirm('Run a strategy scan? In live mode this can place real exchange orders using the configured limits.')) return;
    setScanning(true);
    setActionMessage('');
    try {
      const result = await runStrategyScan();
      if (!result) throw new Error('The strategy scan did not confirm a result.');
      setActionMessage(`Scan completed: ${result.tradesOpened} opened, ${result.tradesClosed} closed.`);
      await refresh();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'The scan failed.');
    } finally { setScanning(false); }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Activity className="h-5 w-5 text-emerald-400" />
        <h2 className="text-base font-semibold text-zinc-200">Live Execution</h2>
        <span className={`text-xs ${stale && overview ? 'text-amber-400' : 'text-zinc-500'}`}>
          {overview ? `${stale ? 'Last known snapshot' : 'Exchange snapshot'} · ${time(overview.fetchedAt)}` : loading ? 'Connecting to exchange…' : 'Exchange unavailable'}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} disabled={loading || stale || orders.length === 0} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 disabled:opacity-40"><Download className="h-3.5 w-3.5" />Export CSV</button>
          <button onClick={() => void handleScanNow()} disabled={scanning || loading || stale || !overview?.canTrade} className="flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"><Zap className="h-3.5 w-3.5" />{scanning ? 'Scanning…' : 'Scan & trade'}</button>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}{snapshot ? ' Values below are from the last successful refresh.' : ' Balances and positions have not been verified.'}</div>}
      {actionMessage && <p role="status" className="rounded-lg border border-zinc-700 p-3 text-sm text-zinc-300">{actionMessage}</p>}
      {overview && !overview.canTrade && <p className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-300">The exchange reports that this account cannot trade. Account data remains available for review.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Metric label="Free USDT" value={overview ? `$${money(usdt?.free ?? 0)}` : '—'} />
        <Metric label="Matched P&L (loaded history)" value={pnlAvailable ? `${summary.realizedPnl < 0 ? '-' : ''}$${money(Math.abs(summary.realizedPnl))}` : '—'} />
        <Metric label="Filled orders in loaded history" value={snapshot && (snapshot.histories.length > 0 || overview?.symbols.length === 0) ? String(summary.filledOrders) : '—'} />
        <Metric label="Open orders on exchange" value={overview?.openOrders ? String(overview.openOrders.length) : '—'} />
      </div>
      {snapshot && <p className="text-xs text-zinc-500">Loaded {snapshot.histories.length} of {overview!.symbols.length} requested USDT pairs. History contains up to 50 recent orders and 1,000 fills per pair; it is not lifetime P&amp;L. {summary.incompleteSells > 0 ? `${summary.incompleteSells} sell orders lack complete cost or fee data and are excluded from P&L.` : ''} {historyIncomplete ? 'Pair coverage is incomplete.' : ''}</p>}
      {!!snapshot?.warnings.length && <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-300"><summary className="cursor-pointer font-semibold">{snapshot.warnings.length} data coverage notice{snapshot.warnings.length === 1 ? '' : 's'}</summary><ul className="mt-3 list-disc space-y-1 pl-5">{snapshot.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200"><Wallet className="h-4 w-4 text-cyan-400" />Exchange holdings</h3>
        <p className="mt-1 text-xs text-zinc-500">Actual free and locked spot balances. Holdings can include deposits, dust, and trades outside this app.</p>
        {!overview ? <p className="mt-4 text-sm text-zinc-500">Balances are unavailable until the exchange responds.</p> : holdings.length === 0 ? <p className="mt-4 text-sm text-zinc-400">No non-USDT balances in this snapshot.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="py-2">Asset</th><th className="py-2 text-right">Free</th><th className="py-2 text-right">Locked</th></tr></thead><tbody>{holdings.map(balance => <tr key={balance.asset} className="border-t border-zinc-800 text-zinc-300"><td className="py-2 font-medium">{balance.asset}</td><td className="py-2 text-right font-mono">{balance.free.toLocaleString('en-US', { maximumFractionDigits: 10 })}</td><td className="py-2 text-right font-mono">{balance.locked.toLocaleString('en-US', { maximumFractionDigits: 10 })}</td></tr>)}</tbody></table></div>}
      </div>
      {!!overview?.reconciliationCandidates.length && <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" />Holdings need reconciliation</h3>
        <p className="mt-2 text-xs text-amber-200/80">These records were marked closed without a recorded sell-order ID, and the exchange still holds the asset. The current balance may come from other trades or deposits; verify the order history before treating a record as open.</p>
        <div className="mt-3 space-y-2">{overview.reconciliationCandidates.map(candidate => <div key={candidate.id} className="flex flex-wrap justify-between gap-2 border-t border-amber-500/15 pt-2 text-xs text-zinc-300"><span>{candidate.symbol} · buy #{candidate.buyOrderId}</span><span>Recorded {candidate.quantity} · exchange {candidate.exchangeBalance ?? 'unverified'}</span></div>)}</div>
      </div>}
      <PairAllowlistPanel />
      <ExecutionOrdersTable orders={orders} loading={loading} available={!!snapshot} partial={historyIncomplete} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"><p className="mb-2 text-xs text-zinc-500">{label}</p><p className="text-2xl font-semibold tabular-nums text-zinc-100">{value}</p></div>;
}
