import { useCallback, useState } from 'react';
import { Eye, ShieldCheck, ShieldAlert, Sparkles, Hourglass, TrendingUp, Percent, Target, Shield } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import { assessTradingStatus } from '@/lib/riskStatus';
import { recordedTradeStats, readTradingResponse } from '@/lib/tradingStatus';
import { buildOracleReading, rankStrategies, type OracleVerdict, ORACLE_MIN_SAMPLE } from '@/lib/oracleReading';
import type { PaperTrade } from '@/lib/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface OracleConfig {
  paperMode: boolean;
  killSwitch: boolean;
  killSwitchReason: string | null;
  maxDailyLossPct: number;
  minWinRateThreshold: number;
  liveCapital: number;
  dailyLossAccumulator: number;
  strategyWinRates: Record<string, { winRate: number; totalTrades: number }>;
}

async function fetchOracleConfig(): Promise<OracleConfig> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/binance-feed/config`, {
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    signal: AbortSignal.timeout(15000),
  });
  const data = await readTradingResponse(res);
  if (typeof data.paperMode !== 'boolean' || typeof data.killSwitch !== 'boolean') {
    throw new Error('Trading configuration is unavailable.');
  }
  return data as unknown as OracleConfig;
}

async function fetchClosedLiveTrades(): Promise<PaperTrade[]> {
  if (!hasDatabaseAccess) throw new Error('Sign-in configuration is required to read trade history.');
  const result = await supabase.from('paper_trades').select('*').eq('is_live', true).eq('status', 'closed').order('closed_at', { ascending: false }).limit(100);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as PaperTrade[];
}

const VERDICT_STYLE: Record<OracleVerdict, { label: string; text: string; border: string; bg: string; Icon: typeof Eye }> = {
  proceed: { label: 'PROCEED', text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', Icon: ShieldCheck },
  caution: { label: 'CAUTION', text: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', Icon: Eye },
  halt: { label: 'HALT', text: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10', Icon: ShieldAlert },
  learning: { label: 'LEARNING', text: 'text-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', Icon: Hourglass },
};

const strategyLabel = (name: string) => name.replace(/_/g, ' ');

export default function TradingOracle() {
  const [config, setConfig] = useState<OracleConfig | null>(null);
  const [history, setHistory] = useState<PaperTrade[]>([]);
  const [configError, setConfigError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(async () => {
    const [cfg, hist] = await Promise.allSettled([fetchOracleConfig(), fetchClosedLiveTrades()]);
    const reason = (cause: unknown) => cause instanceof Error ? cause.message : 'Connection unavailable.';
    if (cfg.status === 'fulfilled') { setConfig(cfg.value); setConfigError(''); }
    else { setConfig(null); setConfigError(reason(cfg.reason)); }
    if (hist.status === 'fulfilled') { setHistory(hist.value); setHistoryError(''); }
    else { setHistory([]); setHistoryError(reason(hist.reason)); }
    setLoaded(true);
  }, []);

  useVisibilityPolling(fetchData, 15_000);

  const failed = config === null && configError !== '';
  const safety = assessTradingStatus(config, failed, false);
  const stats = recordedTradeStats(history);
  const historyAvailable = loaded && !historyError;
  const reading = buildOracleReading({
    safety: safety.level === 'green' ? 'green' : safety.level === 'red' ? 'red' : 'yellow',
    closedTrades: history.length,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    avgWin: stats.avgWin,
    avgLoss: stats.avgLoss,
    profitFactor: stats.profitFactor,
  });
  const style = VERDICT_STYLE[reading.verdict];
  const VerdictIcon = style.Icon;
  const dailyLossLimit = config && config.liveCapital > 0 ? config.liveCapital * config.maxDailyLossPct / 100 : null;
  const dailyLossRoom = config && dailyLossLimit !== null ? Math.max(dailyLossLimit - config.dailyLossAccumulator, 0) : null;
  const strategies = config ? rankStrategies(config.strategyWinRates ?? {}) : [];
  const dataErrors = [configError, historyError].filter(Boolean);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-zinc-100">Trading Oracle</h2>
        </div>
        <span className="text-xs text-zinc-500">A forward-looking read of your live trading record</span>
      </div>

      {dataErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          The reading may be incomplete. {dataErrors.join(' ')}
        </div>
      )}

      <div className={`rounded-2xl border ${style.border} ${style.bg} p-6 transition-colors duration-500`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border ${style.border} bg-zinc-950/60 ${style.text}`}>
            <VerdictIcon className="h-7 w-7" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className={`text-[11px] font-bold tracking-[0.2em] ${style.text}`}>ORACLE READING · {style.label}</p>
            <h3 className="text-xl font-bold text-zinc-100">{reading.headline}</h3>
            <p className="text-xs text-zinc-400">{safety.reasons.join(' ')}</p>
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Evidence gathered</span>
            <span className="font-mono tabular-nums">{history.length} / {ORACLE_MIN_SAMPLE} closed trades</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800">
            <div className={`h-1.5 rounded-full transition-all duration-700 ${style.text.replace('text-', 'bg-')}`} style={{ width: `${reading.sampleProgress * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Expected per trade</p>
          </div>
          <p className={`font-mono text-xl font-bold tabular-nums ${reading.expectedValue === null ? 'text-zinc-500' : reading.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {reading.expectedValue === null || !historyAvailable ? '—' : `${reading.expectedValue >= 0 ? '+' : ''}$${reading.expectedValue.toFixed(4)}`}
          </p>
          <p className="mt-1 text-[10px] text-zinc-600">Average of recorded wins and losses</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Win rate</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">{historyAvailable && stats.winRate !== null ? `${stats.winRate.toFixed(1)}%` : '—'}</p>
          <p className="mt-1 text-[10px] text-zinc-600">{historyAvailable ? `${stats.wins}W / ${stats.losses}L / ${stats.breakeven} flat` : 'Awaiting history'}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-amber-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Profit factor</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {!historyAvailable || stats.profitFactor === null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          </p>
          <p className="mt-1 text-[10px] text-zinc-600">Above 1.00 means gains exceed losses</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-red-400" />
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Daily loss room</p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-zinc-100">{dailyLossRoom === null ? '—' : `$${dailyLossRoom.toFixed(2)}`}</p>
          <p className="mt-1 text-[10px] text-zinc-600">Before the daily loss limit is reached</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-300">Strategy outlook</h3>
          {config && <span className="ml-auto text-[10px] text-zinc-600">Minimum {config.minWinRateThreshold}% win rate to trade</span>}
        </div>
        {strategies.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-600">{configError ? 'Strategy outlook is unavailable.' : 'No strategy results recorded yet.'}</p>
        ) : (
          <ul className="space-y-2">
            {strategies.map(s => {
              const eligible = !config || s.totalTrades < 5 || s.winRate >= config.minWinRateThreshold;
              return (
                <li key={s.strategy} className={`flex items-center gap-3 rounded-lg bg-zinc-950/40 p-3 ${eligible ? '' : 'opacity-60'}`}>
                  <span className="w-40 truncate text-xs font-semibold capitalize text-zinc-200">{strategyLabel(s.strategy)}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                    <div className={`h-1.5 rounded-full ${eligible ? 'bg-cyan-500' : 'bg-zinc-600'}`} style={{ width: `${Math.min(s.winRate, 100)}%` }} />
                  </div>
                  <span className="w-14 text-right font-mono text-xs font-bold tabular-nums text-zinc-200">{s.winRate.toFixed(1)}%</span>
                  <span className="w-24 text-right text-[10px] text-zinc-500">{s.totalTrades} trades{eligible ? '' : ' · paused'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
