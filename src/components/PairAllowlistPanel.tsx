import { useCallback, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';

interface AllowlistRow {
  faction_id: string;
  symbol: string;
  enabled: boolean;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function PairAllowlistPanel() {
  const [rows, setRows] = useState<AllowlistRow[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('bot_pair_allowlist')
      .select('faction_id, symbol, enabled')
      .order('symbol', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setRows((data ?? []) as AllowlistRow[]);
      setError('');
    }
    setLoaded(true);
  }, []);

  useVisibilityPolling(refresh, 30_000, hasDatabaseAccess);

  async function toggle(row: AllowlistRow) {
    const key = `${row.faction_id}|${row.symbol}`;
    setPending(key);
    setError('');
    const { data, error: updateError } = await supabase
      .from('bot_pair_allowlist')
      .update({ enabled: !row.enabled, updated_at: new Date().toISOString() })
      .eq('faction_id', row.faction_id)
      .eq('symbol', row.symbol)
      .select('enabled');
    if (updateError || !data || data.length === 0) {
      setError(updateError?.message ?? 'That change was not saved. Make sure you are signed in as an operator.');
    }
    setPending(null);
    await refresh();
  }

  const enabledCount = rows.filter(r => r.enabled).length;
  const enabledCoins = new Set(rows.filter(r => r.enabled).map(r => r.symbol));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <ListChecks className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-300">Bot Pair Allowlist</h3>
        <span className="ml-auto text-xs text-zinc-500">{enabledCount} active, all others paused</span>
      </div>

      {error ? (
        <div role="alert" className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {!loaded ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">Loading allowlist...</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">No pairs are on the allowlist. The bots are paused.</p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {rows.map(row => {
            const key = `${row.faction_id}|${row.symbol}`;
            const busy = pending === key;
            return (
              <li key={key} className="flex items-center gap-4 px-5 py-3">
                <span className="w-24 text-sm font-medium text-zinc-200">{row.symbol.replace('USDT', '')}</span>
                <span className="flex-1 text-sm text-zinc-400">{capitalize(row.faction_id)}</span>
                <button
                  role="switch"
                  aria-checked={row.enabled}
                  disabled={busy}
                  onClick={() => { void toggle(row); }}
                  className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${row.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${row.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-zinc-800 px-5 py-3 text-[11px] text-zinc-500">
        {enabledCoins.size === 0
          ? 'No pairs are switched on. Every bot is paused until one is enabled.'
          : 'Any coin and faction pair that is not switched on is paused.'}
      </p>
    </div>
  );
}
