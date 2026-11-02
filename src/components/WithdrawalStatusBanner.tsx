import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { AuditEntry } from '@/lib/types';

interface Permissions {
  ok: boolean;
  enableWithdrawals: boolean | null;
  error?: string;
}

type Tone = 'pending' | 'ok' | 'warn' | 'bad';

const HISTORY_EVENTS = ['withdrawal_completed', 'withdrawal_failed'];
const BLOCKED_PATTERN = /unavailable/i;

const TONE_STYLES: Record<Tone, { box: string; title: string; icon: string }> = {
  pending: { box: 'border-zinc-700 bg-zinc-900/60', title: 'text-zinc-200', icon: 'text-zinc-400' },
  ok: { box: 'border-emerald-500/30 bg-emerald-500/10', title: 'text-emerald-300', icon: 'text-emerald-400' },
  warn: { box: 'border-amber-500/40 bg-amber-500/10', title: 'text-amber-300', icon: 'text-amber-400' },
  bad: { box: 'border-red-500/40 bg-red-500/10', title: 'text-red-300', icon: 'text-red-400' },
};

const TONE_ICONS = {
  pending: Loader2,
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
};

export default function WithdrawalStatusBanner() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [permissionsError, setPermissionsError] = useState('');
  const [lastAttempt, setLastAttempt] = useState<AuditEntry | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [permResult, attemptResult, balanceResult] = await Promise.allSettled([
      operatorFetch('binance-withdraw/permissions').then((res) => res.json() as Promise<Permissions>),
      supabase
        .from('audit_log')
        .select('*')
        .in('event_type', HISTORY_EVENTS)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      operatorFetch('binance-withdraw/balance').then((res) => res.json()),
    ]);

    if (balanceResult.status === 'fulfilled' && balanceResult.value?.ok && Array.isArray(balanceResult.value.nonZeroBalances)) {
      const usdt = balanceResult.value.nonZeroBalances.find((b: { coin: string }) => b.coin === 'USDT');
      const free = usdt ? Number(usdt.free) : 0;
      setUsdtBalance(Number.isFinite(free) ? free : null);
    } else {
      setUsdtBalance(null);
    }

    if (permResult.status === 'fulfilled') {
      setPermissions(permResult.value);
      setPermissionsError('');
    } else {
      setPermissionsError('Could not reach the Binance status service.');
    }

    if (attemptResult.status === 'fulfilled' && !attemptResult.value.error) {
      setLastAttempt((attemptResult.value.data ?? null) as AuditEntry | null);
    }
  }, []);

  useVisibilityPolling(refresh, 30_000, hasDatabaseAccess);

  const blocked = lastAttempt?.event_type === 'withdrawal_failed' && BLOCKED_PATTERN.test(lastAttempt.message);

  let tone: Tone;
  let title: string;
  let detail = '';

  if (permissionsError) {
    tone = 'bad';
    title = 'Binance status unavailable';
    detail = permissionsError;
  } else if (!permissions) {
    tone = 'pending';
    title = 'Checking Binance connection';
  } else if (!permissions.ok) {
    tone = 'bad';
    title = 'Binance is not connected';
    detail = permissions.error ?? 'Binance did not respond.';
  } else if (permissions.enableWithdrawals !== true) {
    tone = 'bad';
    title = 'Withdrawals are not permitted for this API key';
    detail = 'Enable withdrawal permission in your Binance API settings.';
  } else if (blocked) {
    tone = 'warn';
    title = 'Binance is blocking withdrawals';
    detail = 'Binance reports withdrawals are temporarily unavailable on its side. Transfers resume automatically once Binance lifts the block.';
  } else {
    tone = 'ok';
    title = 'Connected and withdrawals are available';
  }

  const Icon = TONE_ICONS[tone];
  const styles = TONE_STYLES[tone];
  const attemptLine = lastAttempt
    ? `Last withdrawal attempt ${new Date(lastAttempt.created_at).toLocaleString()}: ${lastAttempt.event_type === 'withdrawal_completed' ? 'submitted' : 'failed'}`
    : 'No withdrawal attempts yet.';

  return (
    <section role="status" aria-live="polite" className={`flex items-start gap-3 rounded-xl border p-4 transition-colors duration-500 ${styles.box}`}>
      <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${styles.icon} ${tone === 'pending' ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className={`text-sm font-semibold ${styles.title}`}>{title}</p>
          <p className="text-xs text-zinc-400">
            Real Binance balance{' '}
            <span className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
              {usdtBalance === null ? '—' : `${usdtBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
            </span>
          </p>
        </div>
        {detail && <p className="mt-1 text-xs leading-relaxed text-zinc-300">{detail}</p>}
        <p className="mt-2 font-mono text-[11px] text-zinc-500">{attemptLine}</p>
      </div>
    </section>
  );
}
