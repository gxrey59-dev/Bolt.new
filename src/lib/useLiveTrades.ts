import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { TradeRecord } from '@/lib/factionPerformance';

export function useLiveTrades() {
  const [trades, setTrades] = useState<TradeRecord[] | null>(null);
  const [error, setError] = useState('');

  const fetchTrades = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('paper_trades')
      .select('faction_id, status, pnl, opened_at, closed_at')
      .eq('is_live', true)
      .order('opened_at', { ascending: false })
      .limit(5000);
    if (queryError) {
      setError('Live trade results could not be loaded. Retrying shortly.');
      return;
    }
    setTrades((data ?? []) as TradeRecord[]);
    setError('');
  }, []);

  useVisibilityPolling(fetchTrades, 30_000);

  return { trades, error };
}
