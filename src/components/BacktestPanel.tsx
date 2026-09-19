import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Play, TrendingUp, TrendingDown, Activity, Target, Zap, Award, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

interface BacktestRun {
  id: string;
  label: string;
  years: number;
  iterations: number;
  starting_capital: number;
  final_equity: number;
  total_return_pct: number;
  annualized_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  avg_hold_periods: number;
  strategy_params: Record<string, unknown>;
  equity_curve: Array<{ period: number; equity: number }>;
  strategy_breakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
  status: string;
  created_at: string;
}

interface RunResult {
  runId: string;
  years: number;
  iterations: number;
  baseParams: Record<string, unknown>;
  optimizedParams: Record<string, unknown>;
  optimized: {
    finalEquity: number;
    totalReturnPct: number;
    annualizedReturnPct: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    sortinoRatio: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    bestTradePct: number;
    worstTradePct: number;
    avgHoldPeriods: number;
    strategyBreakdown: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
    equityCurve: Array<{ period: number; equity: number }>;
  };
  monteCarlo: {
    best: { finalEquity: number; sharpeRatio: number; maxDrawdownPct: number };
    worst: { finalEquity: number; sharpeRatio: number; maxDrawdownPct: number };
    average: { finalEquity: number; maxDrawdownPct: number; sharpeRatio: number; totalTrades: number; winRate: number };
  };
}

const strategyColors: Record<string, string> = {
  rsi_oversold: '#10b981',
  rsi_overbought: '#ef4444',
  macd_crossover: '#3b82f6',
  momentum_breakout: '#f59e0b',
  mean_reversion: '#06b6d4',
};

const strategyLabels: Record<string, string> = {
  rsi_oversold: 'RSI Oversold',
  rsi_overbought: 'RSI Overbought',
  macd_crossover: 'MACD Crossover',
  momentum_breakout: 'Momentum Breakout',
  mean_reversion: 'Mean Reversion',
};

export default function BacktestPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pastRuns, setPastRuns] = useState<BacktestRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState(50);
  const [iterations, setIterations] = useState(10);
  const [optimize, setOptimize] = useState(true);

  const fetchPastRuns = useCallback(async () => {
    const { data } = await supabase
      .from('backtest_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    setPastRuns(data ?? []);
  }, []);

  useEffect(() => {
    fetchPastRuns();
  }, [fetchPastRuns]);

  async function runBacktest() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/backtest-engine/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          years,
          iterations,
          optimize,
          startingCapital: 10000,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const data: RunResult = await res.json();
      setResult(data);
      await fetchPastRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  }

  async function loadRun(run: BacktestRun) {
    setResult({
      runId: run.id,
      years: run.years,
      iterations: run.iterations,
      baseParams: (run.strategy_params as Record<string, Record<string, unknown>>)?.base ?? {},
      optimizedParams: (run.strategy_params as Record<string, Record<string, unknown>>)?.optimized ?? {},
      optimized: {
        finalEquity: Number(run.final_equity),
        totalReturnPct: Number(run.total_return_pct),
        annualizedReturnPct: Number(run.annualized_return_pct),
        maxDrawdownPct: Number(run.max_drawdown_pct),
        sharpeRatio: Number(run.sharpe_ratio),
        sortinoRatio: Number(run.sortino_ratio),
        totalTrades: run.total_trades,
        winningTrades: run.winning_trades,
        losingTrades: run.losing_trades,
        winRate: Number(run.win_rate),
        avgWin: Number(run.avg_win),
        avgLoss: Number(run.avg_loss),
        profitFactor: Number(run.profit_factor),
        bestTradePct: Number(run.best_trade_pct),
        worstTradePct: Number(run.worst_trade_pct),
        avgHoldPeriods: Number(run.avg_hold_periods),
        strategyBreakdown: run.strategy_breakdown as Record<string, { trades: number; wins: number; pnl: number; winRate: number }>,
        equityCurve: run.equity_curve as Array<{ period: number; equity: number }>,
      },
      monteCarlo: {
        best: { finalEquity: 0, sharpeRatio: 0, maxDrawdownPct: 0 },
        worst: { finalEquity: 0, sharpeRatio: 0, maxDrawdownPct: 0 },
        average: { finalEquity: 0, maxDrawdownPct: 0, sharpeRatio: 0, totalTrades: 0, winRate: 0 },
      },
    });
  }

  // Equity curve SVG
  const equityCurve = result?.optimized.equityCurve ?? [];
  const curveWidth = 800;
  const curveHeight = 200;
  const maxEquity = Math.max(...equityCurve.map((p) => p.equity), 1);
  const minEquity = Math.min(...equityCurve.map((p) => p.equity), 0);
  const equityRange = maxEquity - minEquity || 1;
  const curvePath = equityCurve.length > 1
    ? equityCurve.map((p, i) => {
        const x = (i / (equityCurve.length - 1)) * curveWidth;
        const y = curveHeight - ((p.equity - minEquity) / equityRange) * curveHeight;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ')
    : '';

  const opt = result?.optimized;
  const mc = result?.monteCarlo;
  const baseParams = result?.baseParams as Record<string, number | string[]> | undefined;
  const optimizedParams = result?.optimizedParams as Record<string, number | string[]> | undefined;
  const breakdown = opt?.strategyBreakdown ?? {};

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-cyan-400" />
        <h2 className="text-base font-semibold text-zinc-200">Backtest Simulator</h2>
        <span className="ml-auto text-xs text-zinc-500">50-year Monte Carlo + Parameter Optimization</span>
      </div>

      {/* Controls */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-[11px] uppercase text-zinc-600">Years</label>
            <input
              type="number"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              min={1}
              max={100}
              disabled={running}
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase text-zinc-600">MC Iterations</label>
            <input
              type="number"
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              min={1}
              max={50}
              disabled={running}
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={optimize}
                onChange={(e) => setOptimize(e.target.checked)}
                disabled={running}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-cyan-500"
              />
              Optimize Parameters
            </label>
          </div>
          <button
            onClick={runBacktest}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {running ? 'Running...' : 'Run Backtest'}
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {running && !result && (
        <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400" />
            <p className="text-sm text-zinc-500">Simulating {years} years across {iterations} paths...</p>
          </div>
        </div>
      )}

      {opt && result && (
        <>
          {/* Key Metrics */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <MetricCard
              icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
              label="Total Return"
              value={`${opt.totalReturnPct >= 0 ? '+' : ''}${opt.totalReturnPct.toFixed(1)}%`}
              valueClass={opt.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <MetricCard
              icon={<Activity className="h-4 w-4 text-blue-400" />}
              label="Annualized"
              value={`${opt.annualizedReturnPct >= 0 ? '+' : ''}${opt.annualizedReturnPct.toFixed(2)}%`}
              valueClass={opt.annualizedReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <MetricCard
              icon={<TrendingDown className="h-4 w-4 text-red-400" />}
              label="Max Drawdown"
              value={`${opt.maxDrawdownPct.toFixed(1)}%`}
              valueClass="text-red-400"
            />
            <MetricCard
              icon={<BarChart3 className="h-4 w-4 text-amber-400" />}
              label="Sharpe Ratio"
              value={opt.sharpeRatio.toFixed(2)}
              valueClass={opt.sharpeRatio >= 1 ? 'text-emerald-400' : 'text-amber-400'}
            />
            <MetricCard
              icon={<Target className="h-4 w-4 text-cyan-400" />}
              label="Sortino Ratio"
              value={opt.sortinoRatio.toFixed(2)}
              valueClass={opt.sortinoRatio >= 1 ? 'text-emerald-400' : 'text-amber-400'}
            />
            <MetricCard
              icon={<Zap className="h-4 w-4 text-zinc-400" />}
              label="Profit Factor"
              value={opt.profitFactor.toFixed(2)}
              valueClass={opt.profitFactor >= 1.5 ? 'text-emerald-400' : opt.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'}
            />
          </div>

          {/* Equity Curve + Trade Stats */}
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Equity Curve (Optimized)</h3>
              {equityCurve.length > 1 ? (
                <svg viewBox={`0 0 ${curveWidth} ${curveHeight}`} className="w-full" preserveAspectRatio="none" style={{ height: '200px' }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {curvePath && (
                    <>
                      <path
                        d={`${curvePath} L ${curveWidth} ${curveHeight} L 0 ${curveHeight} Z`}
                        fill="url(#equityGrad)"
                      />
                      <path d={curvePath} fill="none" stroke="#06b6d4" strokeWidth="1.5" />
                    </>
                  )}
                  <line
                    x1="0" y1={curveHeight - ((10000 - minEquity) / equityRange) * curveHeight}
                    x2={curveWidth} y2={curveHeight - ((10000 - minEquity) / equityRange) * curveHeight}
                    stroke="#52525b" strokeWidth="0.5" strokeDasharray="4 4"
                  />
                </svg>
              ) : (
                <p className="py-12 text-center text-xs text-zinc-600">No equity data</p>
              )}
              <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
                <span>Start: ${result.years ? '10,000' : '—'}</span>
                <span>Final: ${opt.finalEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Trade Statistics</h3>
              <div className="space-y-2 text-xs">
                <StatRow label="Total Trades" value={opt.totalTrades.toLocaleString()} />
                <StatRow label="Win Rate" value={`${opt.winRate.toFixed(1)}%`} valueClass={opt.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'} />
                <StatRow label="Winning" value={opt.winningTrades.toLocaleString()} valueClass="text-emerald-400" />
                <StatRow label="Losing" value={opt.losingTrades.toLocaleString()} valueClass="text-red-400" />
                <StatRow label="Avg Win" value={`+${opt.avgWin.toFixed(2)}`} valueClass="text-emerald-400" />
                <StatRow label="Avg Loss" value={`-${opt.avgLoss.toFixed(2)}`} valueClass="text-red-400" />
                <StatRow label="Best Trade" value={`+${opt.bestTradePct.toFixed(1)}%`} valueClass="text-emerald-400" />
                <StatRow label="Worst Trade" value={`${opt.worstTradePct.toFixed(1)}%`} valueClass="text-red-400" />
                <StatRow label="Avg Hold" value={`${opt.avgHoldPeriods.toFixed(0)} periods`} />
              </div>
            </div>
          </div>

          {/* Monte Carlo Summary */}
          {mc && mc.average.finalEquity > 0 && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Monte Carlo Distribution ({result.iterations} iterations)</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-zinc-950/60 p-3 text-center">
                  <p className="text-[10px] uppercase text-zinc-600">Best Case</p>
                  <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                    ${mc.best.finalEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-zinc-600">Sharpe {mc.best.sharpeRatio.toFixed(2)} / DD {mc.best.maxDrawdownPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-zinc-950/60 p-3 text-center">
                  <p className="text-[10px] uppercase text-zinc-600">Average</p>
                  <p className="mt-1 font-mono text-lg font-bold text-zinc-200">
                    ${mc.average.finalEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-zinc-600">Sharpe {mc.average.sharpeRatio.toFixed(2)} / DD {mc.average.maxDrawdownPct.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-zinc-950/60 p-3 text-center">
                  <p className="text-[10px] uppercase text-zinc-600">Worst Case</p>
                  <p className="mt-1 font-mono text-lg font-bold text-red-400">
                    ${mc.worst.finalEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-zinc-600">Sharpe {mc.worst.sharpeRatio.toFixed(2)} / DD {mc.worst.maxDrawdownPct.toFixed(1)}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Strategy Breakdown */}
          {Object.keys(breakdown).length > 0 && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Strategy Performance Breakdown</h3>
              <div className="space-y-2">
                {Object.entries(breakdown).map(([strategy, stats]) => {
                  const color = strategyColors[strategy] ?? '#71717a';
                  return (
                    <div key={strategy} className="flex items-center gap-3 rounded-lg bg-zinc-950/40 px-3 py-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="w-36 text-xs font-semibold text-zinc-300">{strategyLabels[strategy] ?? strategy}</span>
                      <span className="font-mono text-xs text-zinc-500">{stats.trades} trades</span>
                      <span className={`font-mono text-xs ${stats.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {stats.winRate.toFixed(1)}% win
                      </span>
                      <span className={`ml-auto font-mono text-xs font-bold ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {stats.pnl >= 0 ? '+' : ''}{stats.pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optimized Parameters */}
          {optimizedParams && baseParams && (
            <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Award className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-cyan-400">Optimized Parameters</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {(['rsiOversold', 'rsiOverbought', 'stopLossPct', 'takeProfitPct', 'momentumLookback', 'maxPositionPct'] as const).map((key) => {
                  const baseVal = baseParams[key] as number;
                  const optVal = optimizedParams[key] as number;
                  const changed = baseVal !== optVal;
                  return (
                    <div key={key} className="rounded-lg bg-zinc-950/60 p-3">
                      <p className="text-[10px] uppercase text-zinc-600">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</p>
                      <p className="font-mono text-sm font-bold text-cyan-400">{optVal}</p>
                      {changed && (
                        <p className="text-[10px] text-zinc-600">was {baseVal}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Past Runs */}
      {pastRuns.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">Past Backtest Runs</h3>
          <div className="space-y-1">
            {pastRuns.map((run) => (
              <button
                key={run.id}
                onClick={() => loadRun(run)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/40"
              >
                <span className="font-semibold text-zinc-300">{run.label}</span>
                <span className="font-mono text-zinc-600">
                  {Number(run.total_return_pct).toFixed(1)}% return
                </span>
                <span className="font-mono text-zinc-600">
                  Sharpe {Number(run.sharpe_ratio).toFixed(2)}
                </span>
                <span className="font-mono text-zinc-600">
                  DD {Number(run.max_drawdown_pct).toFixed(1)}%
                </span>
                <span className="ml-auto text-[10px] text-zinc-600">
                  {new Date(run.created_at).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MetricCard({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-1 flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-lg font-bold tabular-nums ${valueClass ?? 'text-zinc-200'}`}>{value}</p>
    </div>
  );
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-mono tabular-nums ${valueClass ?? 'text-zinc-300'}`}>{value}</span>
    </div>
  );
}
