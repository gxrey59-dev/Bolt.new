import { useCallback, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDownToLine, Check, Copy, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, SlidersHorizontal, Wallet } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface SwarmWallet {
  address: string;
  chain: string;
  max_action_usd: number;
  daily_cap_usd: number;
  created_at: string;
}
interface Balance { symbol: string; amount: string }
interface Deposit { symbol: string; amount: string; hash: string; from: string; at: string }
interface Status {
  wallet: SwarmWallet | null;
  balances?: Balance[] | null;
  checkedAt?: string;
  source?: string;
  error?: string;
  deposits?: Deposit[] | null;
  depositsError?: string;
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const inputClass = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-100 focus:border-teal-500/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20';

async function callWallet(path: string, init?: RequestInit): Promise<Status> {
  const res = await operatorFetch(`swarm-wallet/${path}`, init);
  const data = await res.json().catch(() => null) as (Status & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? `Swarm wallet returned HTTP ${res.status}.`);
  if (data.wallet !== null && (typeof data.wallet !== 'object' || !addressPattern.test(data.wallet.address))) {
    throw new Error('The swarm wallet response was malformed.');
  }
  return data;
}

export default function SwarmWalletSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await callWallet('status'));
      setLoadError('');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Swarm wallet is unavailable.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useVisibilityPolling(refresh, 30_000, true);

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400"><Wallet className="h-5 w-5" /></div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-zinc-100">Swarm Wallet</h2>
          <p className="text-xs text-zinc-500">A dedicated Polygon wallet that holds only the funds you assign to automated swarm actions.</p>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh
        </button>
      </header>

      {loadError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{loadError}</p>}

      {status === null && !loadError && <div className="flex justify-center py-20 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {status && !status.wallet && <CreateWalletCard onCreated={setStatus} />}
      {status?.wallet && (
        <>
          <DepositCard wallet={status.wallet} />
          <BalancesCard status={status} />
          <DepositsCard status={status} />
          <LimitsCard wallet={status.wallet} onSaved={wallet => setStatus(prev => prev ? { ...prev, wallet } : prev)} />
        </>
      )}
    </section>
  );
}

function CreateWalletCard({ onCreated }: { onCreated: (status: Status) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setCreating(true);
    setError('');
    try {
      const created = await callWallet('create', { method: 'POST' });
      onCreated({ wallet: created.wallet, balances: null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet creation failed.');
    } finally {
      setCreating(false);
    }
  }

  const points = [
    { icon: KeyRound, title: 'Key never leaves the server', body: 'The private key is generated and encrypted on the server. It is never shown, downloaded, or sent to this browser.' },
    { icon: ShieldCheck, title: 'Isolated from your main funds', body: 'Only what you deposit here is at risk. Your Binance vault and personal wallets stay untouched.' },
    { icon: SlidersHorizontal, title: 'Hard spending limits', body: 'Set a per-action limit and a daily cap that automated actions must stay within.' },
  ];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-teal-500/5 via-zinc-900/60 to-zinc-950 p-8">
      <h3 className="text-base font-semibold text-zinc-100">Set up the swarm wallet</h3>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">Create a fresh wallet used only by the swarm. You fund it by sending tokens to its address on Polygon.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {points.map(p => (
          <div key={p.title} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p.icon className="h-4 w-4 text-teal-400" />
            <p className="mt-3 text-sm font-medium text-zinc-200">{p.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{p.body}</p>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      {confirming ? (
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="flex items-start gap-2 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />Because the key is held only on the server, there is no recovery phrase to back up. Keep only small amounts in this wallet.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => void create()} disabled={creating} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-60">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}I understand, create wallet
            </button>
            <button onClick={() => setConfirming(false)} disabled={creating} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="mt-6 flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500">
          <Wallet className="h-4 w-4" />Create swarm wallet
        </button>
      )}
    </div>
  );
}

function DepositCard({ wallet }: { wallet: SwarmWallet }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl border border-teal-500/20 bg-zinc-900/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Deposit address</p>
        <span className="rounded-full bg-teal-500/10 px-2.5 py-1 text-[10px] font-semibold text-teal-300">POLYGON ONLY</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 break-all rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-100">{wallet.address}</code>
        <button onClick={() => void copy()} className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700">
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}
        </button>
        <a href={`https://polygonscan.com/address/${wallet.address}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
          <ExternalLink className="h-4 w-4" />PolygonScan
        </a>
      </div>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-300/90"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />Send only on the Polygon network. Include a little POL for network fees. Tokens sent on other networks may not be recoverable.</p>
    </div>
  );
}

function BalancesCard({ status }: { status: Status }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Funded balance</p>
        {status.checkedAt && <p className="text-[11px] text-zinc-600">Checked {new Date(status.checkedAt).toLocaleTimeString()} via {status.source}</p>}
      </div>
      {status.balances ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {status.balances.map(b => (
            <div key={b.symbol} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{b.symbol}</p>
              <p className={`mt-1 break-all font-mono text-lg font-semibold ${Number(b.amount) > 0 ? 'text-zinc-100' : 'text-zinc-600'}`}>{b.amount}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">{status.error ?? 'Balances will appear after the next refresh.'}</p>
      )}
    </div>
  );
}

function DepositsCard({ status }: { status: Status }) {
  const deposits = Array.isArray(status.deposits) ? status.deposits : null;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex items-center gap-2">
        <ArrowDownToLine className="h-4 w-4 text-teal-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Deposit history</p>
      </div>
      {deposits === null ? (
        <p className="mt-4 text-sm text-zinc-500">{status.depositsError ?? 'Deposit history will appear after the next refresh.'}</p>
      ) : deposits.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No deposits yet. Funds you send to the address above will show up here.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800/80">
          {deposits.map(d => (
            <li key={`${d.hash}-${d.symbol}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-mono font-semibold text-emerald-400">+{d.amount} {d.symbol}</span>
              <span className="font-mono text-xs text-zinc-500">from {d.from.slice(0, 8)}…{d.from.slice(-6)}</span>
              <span className="ml-auto text-xs text-zinc-500">{new Date(d.at).toLocaleString()}</span>
              <a href={`https://polygonscan.com/tx/${d.hash}`} target="_blank" rel="noopener noreferrer" aria-label="View transaction on PolygonScan" className="text-zinc-500 transition-colors hover:text-teal-300">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LimitsCard({ wallet, onSaved }: { wallet: SwarmWallet; onSaved: (wallet: SwarmWallet) => void }) {
  const [maxAction, setMaxAction] = useState(String(wallet.max_action_usd));
  const [dailyCap, setDailyCap] = useState(String(wallet.daily_cap_usd));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const perAction = Number(maxAction);
    const perDay = Number(dailyCap);
    if (!(perAction > 0) || !(perDay > 0)) return setMessage({ ok: false, text: 'Both limits must be greater than zero.' });
    if (perAction > perDay) return setMessage({ ok: false, text: 'The per-action limit cannot be higher than the daily cap.' });
    setSaving(true);
    setMessage(null);
    try {
      const saved = await callWallet('limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_action_usd: perAction, daily_cap_usd: perDay }),
      });
      if (saved.wallet) onSaved(saved.wallet);
      setMessage({ ok: true, text: 'Spending limits saved.' });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : 'Could not save limits.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Spending limits</p>
      <p className="mt-1 text-xs text-zinc-500">Automated actions will never exceed these amounts, valued in US dollars.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Max per action ($)</span>
          <input type="number" min="1" step="0.01" inputMode="decimal" value={maxAction} onChange={e => setMaxAction(e.target.value)} className={inputClass} required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Daily cap ($)</span>
          <input type="number" min="1" step="0.01" inputMode="decimal" value={dailyCap} onChange={e => setDailyCap(e.target.value)} className={inputClass} required />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save limits
        </button>
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-300'}`}>{message.text}</p>}
      </div>
    </form>
  );
}
