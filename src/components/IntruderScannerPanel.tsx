import { useCallback, useState } from 'react';
import { Eye, Fingerprint, Radar, RefreshCw } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface IntruderEvent {
  id: string;
  occurred_at: string;
  function_name: string;
  route: string;
  method: string;
  client_ip: string | null;
  reason: string;
  detail: string | null;
}

interface IntrusionPayload {
  events: IntruderEvent[];
  totals: {
    last7Days: number;
    uniqueIps: number;
    byReason: Record<string, number>;
  };
  refreshedAt: string;
}

const REASON_LABELS: Record<string, string> = {
  no_token: 'No credentials',
  invalid_token: 'Invalid credentials',
  not_operator: 'Non-operator account',
  bad_cron_secret: 'Wrong job secret',
};

const REASON_STYLES: Record<string, string> = {
  no_token: 'bg-amber-500/15 text-amber-400',
  invalid_token: 'bg-amber-500/15 text-amber-400',
  not_operator: 'bg-red-500/15 text-red-400',
  bad_cron_secret: 'bg-red-500/15 text-red-400',
};

export default function IntruderScannerPanel() {
  const [data, setData] = useState<IntrusionPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const response = await operatorFetch('binance-feed/intrusions');
      if (!response.ok) throw new Error(`Scanner returned HTTP ${response.status}`);
      const payload = await response.json() as IntrusionPayload;
      if (!payload || !Array.isArray(payload.events)) throw new Error('Scanner response is incomplete');
      setData(payload);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Intruder scan failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityPolling(scan, 30_000, true);

  const totals = data?.totals;
  const heat = totals && totals.last7Days > 20
    ? { text: 'text-red-400', label: 'Elevated activity' }
    : totals && totals.last7Days > 0
      ? { text: 'text-amber-400', label: 'Occasional probes' }
      : { text: 'text-emerald-400', label: 'No intrusion attempts recorded' };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Intruder Scanner</h2>
        <button
          onClick={() => { void scan(); }}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Scan now
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Last 7 days</p>
          <p className={`mt-1 font-mono text-xl font-bold ${heat.text}`}>{totals ? totals.last7Days : '—'}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Unique IPs</p>
          <p className={`mt-1 font-mono text-xl font-bold ${heat.text}`}>{totals ? totals.uniqueIps : '—'}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Posture</p>
          <p className={`mt-1 text-xs font-semibold leading-snug ${heat.text}`}>{totals ? heat.label : 'Scanning…'}</p>
        </div>
      </div>

      {totals && totals.last7Days > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(totals.byReason).map(([reason, count]) => (
            <span
              key={reason}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${REASON_STYLES[reason] ?? 'bg-zinc-800 text-zinc-400'}`}
            >
              {(REASON_LABELS[reason] ?? reason)} ×{count}
            </span>
          ))}
        </div>
      )}

      <div className="max-h-72 space-y-1 overflow-y-auto">
        {!data ? (
          <p className="py-6 text-center text-xs text-zinc-600">Run a scan to check the gates.</p>
        ) : data.events.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-center text-xs text-zinc-600">
            <Eye className="h-3.5 w-3.5" />
            No intrusion attempts in the last 7 days.
          </p>
        ) : (
          data.events.map((e) => (
            <div key={e.id} className="rounded-lg px-3 py-2 text-xs transition-colors hover:bg-zinc-800/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${REASON_STYLES[e.reason] ?? 'bg-zinc-800 text-zinc-400'}`}>
                  {REASON_LABELS[e.reason] ?? e.reason}
                </span>
                <span className="font-mono text-[10px] text-zinc-400">{e.function_name}{e.route}</span>
                {e.client_ip && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                    <Fingerprint className="h-3 w-3" />
                    {e.client_ip}
                  </span>
                )}
                <span className="ml-auto font-mono tabular-nums text-[10px] text-zinc-600">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
              </div>
              {e.detail && <p className="mt-1 break-words leading-relaxed text-zinc-400">{e.detail}</p>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
