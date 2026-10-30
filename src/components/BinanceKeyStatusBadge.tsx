import { useState, useCallback } from 'react';
import { KeyRound, Copy, Check, Wifi } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface KeyStatus {
  ok: boolean;
  egressIp: string | null;
  enableWithdrawals: boolean | null;
  enableSpotAndMarginTrading: boolean | null;
  enableReading: boolean | null;
  error?: string;
  checkedAt: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function Badge({ label, value }: { label: string; value: boolean | null }) {
  const known = value !== null;
  const on = value === true;
  const tone = !known
    ? 'border-zinc-700 bg-zinc-800/60 text-zinc-500'
    : on
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : 'border-red-500/30 bg-red-500/10 text-red-400';
  const text = !known ? 'Unknown' : on ? 'Active' : 'Off';
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${tone}`}>
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase">
        <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-400 animate-pulse' : known ? 'bg-red-400' : 'bg-zinc-600'}`} />
        {text}
      </span>
    </div>
  );
}

export default function BinanceKeyStatusBadge() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-withdraw/permissions`, {
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      });
      const data = (await res.json()) as KeyStatus;
      setStatus(data);
      setFetchError('');
    } catch {
      setFetchError('Could not reach the status service.');
    }
  }, []);

  useVisibilityPolling(fetchStatus, 60_000);

  async function copyIp() {
    if (!status?.egressIp) return;
    await navigator.clipboard.writeText(status.egressIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const healthy = status?.ok === true;
  const withdrawalsOn = status?.enableWithdrawals === true;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Binance API Key Status</h2>
        <span
          className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
            !status ? 'bg-zinc-800 text-zinc-500'
              : healthy ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${!status ? 'bg-zinc-600' : healthy ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {!status ? 'Checking' : healthy ? 'Connected' : 'Error'}
        </span>
      </div>

      {fetchError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {fetchError}
        </p>
      )}

      {status && !healthy && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 break-words">
          Binance did not return permissions: {status.error ?? 'unknown error'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Badge label="Withdrawals" value={status?.enableWithdrawals ?? null} />
        <Badge label="Spot trading" value={status?.enableSpotAndMarginTrading ?? null} />
        <Badge label="Reading" value={status?.enableReading ?? null} />
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
        <Wifi className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs text-zinc-400">Server IP</span>
        <span className="font-mono text-xs tabular-nums text-zinc-200">{status?.egressIp ?? '...'}</span>
        {status?.egressIp && (
          <button
            type="button"
            onClick={copyIp}
            className="ml-auto flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {status && !withdrawalsOn && healthy && (
        <p className="mt-3 text-[11px] text-zinc-500">
          Withdrawals are off for this key. Enable withdrawal permission in your Binance API settings, then allow this server IP if the key is IP-restricted.
        </p>
      )}
      {status?.checkedAt && (
        <p className="mt-2 text-right font-mono text-[10px] text-zinc-600">
          Checked {new Date(status.checkedAt).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}
