export interface FeedConfig {
  paperMode: boolean;
  killSwitch: boolean;
  killSwitchReason?: string | null;
  dailyLossAccumulator?: number;
  maxDailyLossPct?: number;
  liveCapital?: number;
}

export function assessTradingStatus(config: FeedConfig | null, failed: boolean, stale: boolean) {
  const checkedAt = Date.now();
  if (failed) return { level: 'yellow' as const, title: 'Trading status unavailable', reasons: ['Could not reach the trading service. Current controls are unverified.'], checkedAt };
  if (!config) return { level: 'yellow' as const, title: 'Checking trading status', reasons: ['Waiting for the trading service.'], checkedAt: null };
  if (config.killSwitch) return { level: 'red' as const, title: 'Kill switch active — trading halted', reasons: [config.killSwitchReason || 'The kill switch is active.'], checkedAt };
  const reasons = [config.paperMode ? 'Paper mode is configured.' : 'Live mode is configured. Exchange holdings require account verification.'];
  let caution = !config.paperMode || stale;
  const capital = config.liveCapital;
  if (!config.paperMode && capital != null && capital > 0 && config.dailyLossAccumulator != null && config.maxDailyLossPct != null && config.maxDailyLossPct > 0) {
    const limit = capital * config.maxDailyLossPct / 100;
    if (config.dailyLossAccumulator >= limit * 0.7) {
      caution = true;
      reasons.push(`Recorded daily loss is ${config.dailyLossAccumulator.toFixed(2)} USDT against a ${limit.toFixed(2)} USDT threshold (${config.maxDailyLossPct}% of tracked capital).`);
    }
  }
  if (stale) reasons.push('The trading status has not refreshed recently.');
  return { level: caution ? 'yellow' as const : 'green' as const, title: config.paperMode ? 'Paper trading configured' : 'Live trading configured', reasons, checkedAt };
}
