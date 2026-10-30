import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { AuditEntry } from '@/lib/types';

const ERROR_EVENTS = ['withdrawal_failed', 'collection_failed'];

export default function WithdrawalErrorLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');

  const fetchErrors = useCallback(async () => {
    if (!hasDatabaseAccess) return;
    const { data, error: queryError } = await supabase
      .from('audit_log')
      .select('*')
      .in('event_type', ERROR_EVENTS)
      .order('created_at', { ascending: false })
      .limit(25);
    if (queryError) {
      setError(queryError.message);
      return;
    }
    setEntries((data ?? []) as AuditEntry[]);
    setError('');
  }, []);

  useVisibilityPolling(fetchErrors, 15_000, hasDatabaseAccess);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Withdrawal & Collection Errors</h2>
        <span className="ml-auto text-xs text-zinc-500">{entries.length} recent</span>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="max-h-72 space-y-1 overflow-y-auto">
        {entries.length === 0 && !error ? (
          <p className="py-6 text-center text-xs text-zinc-600">No withdrawal or collection errors recorded.</p>
        ) : (
          entries.map(e => {
            const status = e.metadata?.status;
            return (
              <div key={e.id} className="rounded-lg px-3 py-2 text-xs transition-colors hover:bg-zinc-800/40">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-red-400">
                    {e.event_type.replace(/_/g, ' ')}
                  </span>
                  {typeof status === 'number' && (
                    <span className="font-mono text-[10px] text-zinc-500">HTTP {status}</span>
                  )}
                  <span className="ml-auto font-mono tabular-nums text-[10px] text-zinc-600">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 break-words leading-relaxed text-zinc-300">{e.message}</p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
