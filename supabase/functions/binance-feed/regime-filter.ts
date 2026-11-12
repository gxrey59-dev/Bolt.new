export const REGIME_SMA_PERIOD = 50;
export const MAX_HOLD_HOURS = 24;

export function simpleMovingAverage(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function isBtcRegimeBullish(btcCloses: number[], period: number = REGIME_SMA_PERIOD): boolean {
  const sma = simpleMovingAverage(btcCloses, period);
  if (sma === null) return false;
  return btcCloses[btcCloses.length - 1] > sma;
}

export function isMaxHoldExceeded(openedAtMs: number, nowMs: number, maxHours: number = MAX_HOLD_HOURS): boolean {
  return (nowMs - openedAtMs) / (60 * 60 * 1000) >= maxHours;
}
