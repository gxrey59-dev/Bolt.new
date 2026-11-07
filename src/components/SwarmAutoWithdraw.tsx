import { useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowUpFromLine, Clock, ExternalLink, Loader2, Snowflake } from 'lucide-react';
import { addressPattern, postWallet, type Spend, type SwarmWallet } from '@/lib/swarmWallet';

export const inputClass = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-100 focus:border-teal-500/60 focus:ring-2 focus:ring-teal-500/20';

const DELAY_MS = 24 * 60 * 60 * 1000;

function delayRemaining(setAt: string | null) {
  if (!setAt) return 0;
  return Math.max(0, new Date(setAt).getTime() + DELAY_MS - Date.now());
}

function formatHours(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.ceil((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function AutoWithdrawCard({ wallet, onSaved }: { wallet: SwarmWallet; onSaved: (wallet: SwarmWallet) => void }) {
  const [enabled, setEnabled] = useState(wallet.auto_withdraw_enabled);
  const [cold, setCold] = useState(wallet.cold_address ?? '');
  const [reserve, setReserve] = useState(String(wallet.keep_reserve_usd ?? 0));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const trimmed = cold.trim();
  const coldChanged = trimmed.toLowerCase() !== (wallet.cold_address ?? '').toLowerCase();
  const waiting = delayRemaining(wallet.cold_address_set_at);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reserveUsd = Number(reserve);
    if (trimmed && !addressPattern.test(trimmed)) return setMessage({ ok: false, text: 'Enter a valid Polygon address starting with 0x.' });
    if (trimmed.toLowerCase() === wallet.address.toLowerCase()) return setMessage({ ok: false, text: 'Cold storage must be a different wallet.' });
    if (enabled && !trimmed) return setMessage({ ok: false, text: 'Add a cold storage address before turning auto-withdraw on.' });
    if (!Number.isFinite(reserveUsd) || reserveUsd < 0) return setMessage({ ok: false, text: 'Reserve must be zero or more.' });
    setSaving(true);
    setMessage(null);
    try {
      const saved = await postWallet('settings', { auto_withdraw_enabled: enabled, cold_address: trimmed, keep_reserve_usd: reserveUsd });
      if (saved.wallet) {
        onSaved(saved.wallet);
        setCold(saved.wallet.cold_address ?? '');
      }
      setMessage({ ok: true, text: coldChanged && trimmed ? 'Saved. Sweeps to the new address start after the 24-hour safety delay.' : 'Auto-withdraw settings saved.' });
    } catch (cause) {
      setMessage({ ok: false, text: cause instanceof Error ? cause.message : 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400"><Snowflake className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Auto-withdraw to cold storage</p>
            <p className="mt-0.5 max-w-md text-xs leading-relaxed text-zinc-500">Every 10 minutes, stablecoins above your reserve are swept to your cold wallet, one transfer at a time and always within the spending limits.</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Auto-withdraw"
          onClick={() => setEnabled(v => !v)}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${enabled ? 'bg-teal-500' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_180px]">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Cold storage address (Polygon)</span>
          <input value={cold} onChange={e => setCold(e.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Keep in wallet ($)</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={reserve} onChange={e => setReserve(e.target.value)} className={inputClass} />
        </label>
      </div>

      {coldChanged && trimmed && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-300/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />Double-check this address. A new address must wait 24 hours before anything is sent to it, giving you time to catch a mistake or an unwanted change.
        </p>
      )}
      {!coldChanged && wallet.cold_address && waiting > 0 && (
        <p className="mt-3 flex items-center gap-2 text-xs text-sky-300"><Clock className="h-3.5 w-3.5" />Safety delay: sweeps to this address begin in {formatHours(waiting)}.</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save auto-withdraw
        </button>
        {message && <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-300'}`}>{message.text}</p>}
      </div>

      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs">
        <span className="text-zinc-500">Last run: </span>
        {wallet.last_run_at
          ? <><span className="text-zinc-300">{wallet.last_run_result ?? 'Completed'}</span><span className="text-zinc-600"> · {new Date(wallet.last_run_at).toLocaleString()}</span></>
          : <span className="text-zinc-400">The worker has not run yet.</span>}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">Only USDC, USDC.e and USDT are swept. Keep a little POL in the swarm wallet to pay network fees.</p>
    </form>
  );
}

const statusStyles: Record<Spend['status'], string> = {
  confirmed: 'bg-emerald-500/10 text-emerald-300',
  submitted: 'bg-sky-500/10 text-sky-300',
  reserved: 'bg-zinc-700/40 text-zinc-300',
  failed: 'bg-red-500/10 text-red-300',
};
const statusLabels: Record<Spend['status'], string> = { confirmed: 'Confirmed', submitted: 'Pending', reserved: 'Preparing', failed: 'Failed' };

export function SpendsCard({ spends }: { spends: Spend[] }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex items-center gap-2">
        <ArrowUpFromLine className="h-4 w-4 text-sky-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Automated transfers</p>
      </div>
      {spends.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No automated transfers yet. Sweeps to cold storage will be listed here.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-800/80">
          {spends.map(s => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-mono font-semibold text-zinc-100">-{Number(s.amount_usd).toFixed(2)} {s.token}</span>
              <span className="font-mono text-xs text-zinc-500">to {s.to_address.slice(0, 8)}…{s.to_address.slice(-6)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[s.status]}`} title={s.error ?? undefined}>{statusLabels[s.status]}</span>
              <span className="ml-auto text-xs text-zinc-500">{new Date(s.created_at).toLocaleString()}</span>
              {s.tx_hash && (
                <a href={`https://polygonscan.com/tx/${s.tx_hash}`} target="_blank" rel="noopener noreferrer" aria-label="View transfer on PolygonScan" className="text-zinc-500 transition-colors hover:text-teal-300">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {s.status === 'failed' && s.error && <p className="w-full text-xs text-red-300/80">{s.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
