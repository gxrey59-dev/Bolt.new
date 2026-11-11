export type OracleVerdict = 'proceed' | 'caution' | 'halt' | 'learning';

export const ORACLE_MIN_SAMPLE = 20;

export interface OracleInput {
  safety: 'green' | 'yellow' | 'red';
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
}

export interface OracleReading {
  verdict: OracleVerdict;
  headline: string;
  expectedValue: number | null;
  sampleProgress: number;
}

export function buildOracleReading(input: OracleInput): OracleReading {
  const decided = input.wins + input.losses;
  const expectedValue = input.winRate === null || decided === 0
    ? null
    : (input.winRate / 100) * input.avgWin - (1 - input.winRate / 100) * input.avgLoss;
  const sampleProgress = Math.min(input.closedTrades / ORACLE_MIN_SAMPLE, 1);

  if (input.safety === 'red') {
    return { verdict: 'halt', headline: 'Stand down: trading is halted', expectedValue, sampleProgress };
  }
  if (input.closedTrades < ORACLE_MIN_SAMPLE) {
    return { verdict: 'learning', headline: `Still learning: ${input.closedTrades} of ${ORACLE_MIN_SAMPLE} closed trades`, expectedValue, sampleProgress };
  }
  if (expectedValue === null || expectedValue <= 0 || (input.profitFactor !== null && input.profitFactor < 1)) {
    return { verdict: 'caution', headline: 'The edge is not proven yet', expectedValue, sampleProgress };
  }
  if (input.safety === 'yellow') {
    return { verdict: 'caution', headline: 'The edge looks positive, but safety checks are watching', expectedValue, sampleProgress };
  }
  return { verdict: 'proceed', headline: 'Conditions favor continued trading', expectedValue, sampleProgress };
}

export function rankStrategies(stats: Record<string, { winRate: number; totalTrades: number }>) {
  return Object.entries(stats)
    .map(([strategy, value]) => ({ strategy, ...value }))
    .sort((a, b) => b.winRate - a.winRate || b.totalTrades - a.totalTrades);
}
