import { supabase } from './supabase';
import { FACTION_LOSS_THRESHOLD, GLOBAL_LOSS_THRESHOLD } from './constants';
import type { Faction, OpenPosition } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─── Strategy Scan ─────────────────────────────────────────────────
// Calls the edge function which fetches real Binance.US candles,
// calculates indicators, evaluates strategies, and opens/closes paper trades.

export async function runStrategyScan(): Promise<{
  signals: number;
  tradesOpened: number;
  tradesClosed: number;
} | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/scan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.error('Strategy scan failed:', res.status);
      return null;
    }
    const data = await res.json();
    return {
      signals: data.signals ?? 0,
      tradesOpened: data.tradesOpened ?? 0,
      tradesClosed: data.tradesClosed ?? 0,
    };
  } catch (err) {
    console.error('Strategy scan error:', err);
    return null;
  }
}

// ─── Live Price Fetch ──────────────────────────────────────────────

export async function fetchLivePrices(): Promise<
  Array<{ symbol: string; price: number; change: number; volume: number; high: number; low: number }>
> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/prices`, {
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.tickers ?? []).map((t: { symbol: string; price: number; priceChangePercent: number; volume: number; high: number; low: number }) => ({
      symbol: t.symbol,
      price: t.price,
      change: t.priceChangePercent,
      volume: t.volume,
      high: t.high,
      low: t.low,
    }));
  } catch {
    return [];
  }
}

// ─── Open Positions ────────────────────────────────────────────────

export async function fetchOpenPositions(): Promise<OpenPosition[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/positions`, {
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.openPositions ?? [];
  } catch {
    return [];
  }
}

// ─── Emergency Close All ───────────────────────────────────────────

export async function closeAllPositions(): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/close-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

// ─── Faction Profit Update (from closed paper trades) ──────────────
// This is now handled by the edge function when trades close.
// We keep a lightweight version here to sync faction stats from the DB.

export async function updateFactionStats() {
  const { data: factions } = await supabase.from('factions').select('*');
  if (!factions) return;

  const { data: sentiments } = await supabase.from('sentiment').select('*').eq('active', true).limit(1);
  const sentiment = sentiments?.[0];
  const sentimentMode = sentiment?.mode ?? 'neutral';

  for (const f of factions as Faction[]) {
    if (f.status === 'paused' || f.status === 'halted') {
      if (f.paused_until && new Date(f.paused_until) <= new Date()) {
        await supabase.from('factions').update({ status: 'active', paused_until: null }).eq('id', f.id);
      }
      continue;
    }

    // Check loss thresholds using real paper trading losses
    const lossRatio = f.allocated_capital > 0 ? f.loss_today / f.allocated_capital : 0;

    if (lossRatio >= FACTION_LOSS_THRESHOLD && f.status === 'active') {
      await supabase.from('factions').update({
        status: 'paused',
        paused_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }).eq('id', f.id);
      await triggerCircuitBreaker('faction', f.id, lossRatio, FACTION_LOSS_THRESHOLD, 'paper_loss_limit');
    }

    // Apply sentiment effect to status (not to P&L — that's real now)
    if (sentimentMode === 'bearish' && f.status === 'active' && f.consecutive_losses >= 3) {
      await supabase.from('factions').update({
        status: 'cooldown',
        cooldown_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }).eq('id', f.id);
    }
  }

  // Global halt check
  const { data: allFactions } = await supabase.from('factions').select('loss_today, allocated_capital');
  if (allFactions) {
    const totalLoss = allFactions.reduce((s, f) => s + Number(f.loss_today || 0), 0);
    const totalCapital = allFactions.reduce((s, f) => s + Number(f.allocated_capital || 0), 0);
    if (totalCapital > 0 && totalLoss / totalCapital >= GLOBAL_LOSS_THRESHOLD) {
      for (const faction of allFactions as Faction[]) {
        await supabase.from('factions').update({ status: 'halted' }).eq('id', faction.id);
      }
      await triggerCircuitBreaker('global', null, totalLoss / totalCapital, GLOBAL_LOSS_THRESHOLD, 'daily_global_halt');
    }
  }
}

// ─── Sentiment Override ────────────────────────────────────────────

export async function setSentiment(mode: 'bullish' | 'bearish' | 'neutral') {
  await supabase.from('sentiment').update({ active: false }).eq('active', true);
  await supabase.from('sentiment').insert({
    mode,
    label: `${mode.charAt(0).toUpperCase() + mode.slice(1)} Override`,
    triggered_by: 'operator',
    active: true,
  });

  await supabase.from('audit_log').insert({
    event_type: 'sentiment_override',
    entity_type: 'sentiment',
    entity_id: 'system',
    message: `Sentiment set to ${mode}`,
    metadata: { mode },
  });
}

// ─── Circuit Breaker ───────────────────────────────────────────────

async function triggerCircuitBreaker(
  scope: 'faction' | 'global',
  factionId: string | null,
  lossPct: number,
  threshold: number,
  triggerType: string,
) {
  await supabase.from('circuit_breakers').insert({
    scope,
    faction_id: factionId,
    trigger_type: triggerType,
    loss_percent: Math.round(lossPct * 10000) / 100,
    threshold: threshold * 100,
    time_window: scope === 'faction' ? '1 hour' : '24 hours',
    action_taken: scope === 'faction' ? 'faction_paused' : 'global_halt',
    resolved: false,
  });

  await supabase.from('audit_log').insert({
    event_type: 'circuit_breaker',
    entity_type: 'circuit_breakers',
    entity_id: factionId ?? 'global',
    message: scope === 'global'
      ? `GLOBAL HALT — ${(lossPct * 100).toFixed(1)}% loss exceeds ${threshold * 100}% threshold`
      : `Faction ${factionId} paused — ${(lossPct * 100).toFixed(1)}% loss`,
    metadata: { scope, faction_id: factionId, loss_percent: lossPct, threshold },
  });
}
