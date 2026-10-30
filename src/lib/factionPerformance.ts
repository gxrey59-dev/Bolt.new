import type { PaperTrade } from '@/lib/types';

export type PerformanceWindow = '24h' | '7d' | '30d' | 'all';

export const PERFORMANCE_WINDOWS: { id: PerformanceWindow; label: string }[] = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
];

const DAY_MS = 86_400_000;
const WINDOW_MS: Record<PerformanceWindow, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  all: Number.POSITIVE_INFINITY,
};

export interface FactionPerformance {
  factionId: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  harvested: number;
  leaked: number;
  profitFactor: number | null;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
  openPositions: number;
  activity: number;
  lastActivity: string | null;
}

export interface DailyHarvest {
  day: string;
  total: number;
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

export type TradeRecord = Pick<PaperTrade, 'faction_id' | 'status' | 'pnl' | 'opened_at' | 'closed_at'>;

export function parseDbTimestamp(stamp: string | null): number {
  if (!stamp) return Number.NaN;
  return Date.parse(stamp.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
}

export function buildFactionPerformance(
  trades: TradeRecord[],
  factionIds: string[],
  window: PerformanceWindow,
  now: number = Date.now(),
): FactionPerformance[] {
  const cutoff = now - WINDOW_MS[window];

  return factionIds.map(factionId => {
    const mine = trades.filter(t => t.faction_id === factionId);
    const closed = mine.filter(t => t.status === 'closed' && parseDbTimestamp(t.closed_at) >= cutoff);
    const pnls = closed.map(t => Number(t.pnl));
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const harvested = sum(wins);
    const leaked = sum(losses);
    const activity = mine.filter(
      t => parseDbTimestamp(t.opened_at) >= cutoff || parseDbTimestamp(t.closed_at) >= cutoff,
    ).length;
    const lastActivity = mine.reduce<string | null>((latest, t) => {
      const stamp = t.closed_at ?? t.opened_at;
      return latest === null || parseDbTimestamp(stamp) > parseDbTimestamp(latest) ? stamp : latest;
    }, null);

    return {
      factionId,
      closedTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
      realizedPnl: sum(pnls),
      harvested,
      leaked,
      profitFactor: leaked < 0 ? harvested / Math.abs(leaked) : null,
      avgPnl: closed.length > 0 ? sum(pnls) / closed.length : 0,
      bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
      openPositions: mine.filter(t => t.status === 'open').length,
      activity,
      lastActivity,
    };
  });
}

export function buildDailyHarvest(trades: TradeRecord[], days: number, now: number = Date.now()): DailyHarvest[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const t of trades) {
    if (t.status !== 'closed' || !t.closed_at) continue;
    const day = new Date(parseDbTimestamp(t.closed_at)).toISOString().slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + Number(t.pnl));
  }
  return [...buckets.entries()].map(([day, total]) => ({ day, total }));
}
