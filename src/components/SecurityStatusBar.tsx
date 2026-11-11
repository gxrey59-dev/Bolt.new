import { useCallback, useRef, useState } from 'react';
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { assessTradingStatus, type FeedConfig } from '@/lib/riskStatus';

const CONFIG_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-feed/config`;

type Level = 'green' | 'yellow' | 'red';

interface SecurityStatus {
  level: Level;
  title: string;
  reasons: string[];
  checkedAt: number | null;
}

const LEVELS: Record<Level, {
  dot: string; text: string; border: string; bg: string; label: string; icon: typeof ShieldCheck;
}> = {
  green: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
    text: 'text-emerald-300',
    border: 'border-emerald-500/25',
    bg: 'bg-emerald-500/[0.06]',
    label: 'PAPER MODE',
    icon: ShieldCheck,
  },
  yellow: {
    dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/[0.06]',
    label: 'STATUS',
    icon: ShieldAlert,
  },
  red: {
    dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]',
    text: 'text-red-300',
    border: 'border-red-500/40',
    bg: 'bg-red-500/[0.08]',
    label: 'HALTED',
    icon: ShieldX,
  },
};

export default function SecurityStatusBar() {
  const [status, setStatus] = useState<SecurityStatus>({
    level: 'yellow', title: 'Waiting for security feed', reasons: ['First security check in progress.'], checkedAt: null,
  });
  const [expanded, setExpanded] = useState(false);
  const lastSuccessRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    let failed = false;
    let config: FeedConfig | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(CONFIG_URL, {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as FeedConfig;
        if (typeof data.killSwitch !== 'boolean' || typeof data.paperMode !== 'boolean') {
          throw new Error('Malformed security feed response');
        }
        config = data;
        lastSuccessRef.current = Date.now();
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      failed = true;
    }
    const stale = lastSuccessRef.current !== null && Date.now() - lastSuccessRef.current > 90_000;
    setStatus(assessTradingStatus(failed ? null : config, failed, stale));
  }, []);

  useVisibilityPolling(load, 30_000);

  const style = LEVELS[status.level];
  const Icon = style.icon;
  const checkedLabel = status.checkedAt
    ? new Date(status.checkedAt).toLocaleTimeString('en-US', { hour12: false })
    : '—';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b ${style.border} ${style.bg} backdrop-blur-xl transition-colors`}
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${style.dot}`} />
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
        </span>
        <Icon className={`h-4 w-4 flex-shrink-0 ${style.text}`} />
        <span className={`text-xs font-semibold tracking-wide ${style.text}`}>
          {style.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">{status.title}</span>
        {status.reasons.length > 1 || status.level !== 'green' ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="ml-auto flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          >
            Details
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-600">Checked {checkedLabel}</span>
        )}
      </div>
      {expanded && (
        <div className="mx-auto max-w-[1600px] px-4 pb-2 sm:px-6">
          <ul className="space-y-1">
            {status.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-xs text-zinc-400">
                <span className={`mt-1 h-1 w-1 flex-shrink-0 rounded-full ${style.dot}`} />
                {reason}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-zinc-600">Last checked {checkedLabel}</p>
        </div>
      )}
    </div>
  );
}
