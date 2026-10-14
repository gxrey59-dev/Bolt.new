import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BINANCE_BASE = "https://api.binance.us";

import { calibrateGBM, makeRng, generatePricePath, runSingleBacktest, optimizeParams, scoreResult, runSyntheticHoldout, type Candle, type BacktestParams, type BacktestResult } from "./simulation.ts";

async function fetchRealHistory(symbol: string): Promise<Candle[]> {
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=1000`, {
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data as unknown[][]).map((d) => ({
      open: parseFloat(d[1] as string), high: parseFloat(d[2] as string),
      low: parseFloat(d[3] as string), close: parseFloat(d[4] as string),
      volume: parseFloat(d[5] as string),
    }));
  } catch { return []; }
}

// ─── Main Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  let runId: string | null = null;
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/backtest-engine", "");

    if (path === "/run") {
      if (req.method !== "POST") return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers: corsHeaders });
      const body = await req.json().catch(() => ({}));
      const years: number = body.years ?? 50;
      const iterations: number = Math.min(body.iterations ?? 3, 5);
      const startingCapital: number = body.startingCapital ?? 10000;
      const optimize: boolean = body.optimize ?? true;
      const symbols: string[] = body.symbols ?? ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

      if (!Number.isFinite(years) || years < 1 || years > 50 ||
          !Number.isInteger(iterations) || iterations < 1 ||
          !Number.isFinite(startingCapital) || startingCapital <= 0 || typeof optimize !== "boolean" ||
          !Array.isArray(symbols) || symbols.length < 1 || symbols.length > 10 ||
          symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{5,20}$/.test(s)) ||
          new Set(symbols).size !== symbols.length) {
        return new Response(JSON.stringify({ error: "Invalid backtest request" }), { status: 400, headers: corsHeaders });
      }

      // Fetch real history to calibrate GBM
      const calibrationData = new Map<string, { mu: number; sigma: number; startPrice: number }>();
      for (const sym of symbols) {
        calibrationData.set(sym, calibrateGBM(await fetchRealHistory(sym)));
      }

      // Synthetic daily paths are capped; never claim the requested horizon was simulated.
      const periodsPerIteration = Math.min(Math.floor(years * 365) + 1, 2000);
      const actualYears = (periodsPerIteration - 1) / 365;

      const baseParams: BacktestParams = {
        rsiOversold: body.params?.rsiOversold ?? 30,
        rsiOverbought: body.params?.rsiOverbought ?? 70,
        macdThreshold: body.params?.macdThreshold ?? 0,
        momentumLookback: body.params?.momentumLookback ?? 5,
        stopLossPct: body.params?.stopLossPct ?? 2,
        takeProfitPct: body.params?.takeProfitPct ?? 4,
        maxPositionPct: body.params?.maxPositionPct ?? 10,
        feeBps: body.params?.feeBps ?? 10,
        slippageBps: body.params?.slippageBps ?? 5,
        activeStrategies: body.params?.activeStrategies ?? [
          "rsi_oversold", "rsi_overbought", "macd_crossover", "momentum_breakout", "mean_reversion",
        ],
      };

      // Validate strategy/cost inputs before creating a persistent run.
      try {
        runSingleBacktest(new Map([[symbols[0], [100, 100]]]), baseParams, startingCapital);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid strategy or cost parameters" }), { status: 400, headers: corsHeaders });
      }
      const { data: runRecord, error: createError } = await supabase.from("backtest_runs").insert({
        label: `${actualYears.toFixed(2)}-Year SYNTHETIC stress test${optimize ? " + in-sample optimization" : ""}`,
        years: actualYears, iterations, starting_capital: startingCapital, status: "running", strategy_params: baseParams,
      }).select().single();
      if (createError || !runRecord) throw new Error("Unable to create backtest run");
      runId = runRecord.id;

      // Monte Carlo with base params
      let bestResult: BacktestResult | null = null;
      let worstResult: BacktestResult | null = null;
      let sumEquity = 0, sumDD = 0, sumSharpe = 0, sumTrades = 0, sumWinRate = 0;

      for (let iter = 0; iter < iterations; iter++) {
        const rng = makeRng(iter * 1000 + 42);
        const pricePaths = new Map<string, number[]>();
        for (const [sym, cal] of calibrationData) {
          pricePaths.set(sym, generatePricePath(cal.startPrice, cal.mu, cal.sigma, periodsPerIteration, rng));
        }
        const result = runSingleBacktest(pricePaths, baseParams, startingCapital);
        if (!bestResult || scoreResult(result) > scoreResult(bestResult)) bestResult = result;
        if (!worstResult || scoreResult(result) < scoreResult(worstResult)) worstResult = result;
        sumEquity += result.finalEquity;
        sumDD += result.maxDrawdownPct;
        sumSharpe += result.sharpeRatio;
        sumTrades += result.totalTrades;
        sumWinRate += result.winRate;
      }

      const mcAvg = {
        finalEquity: sumEquity / iterations,
        maxDrawdownPct: sumDD / iterations,
        sharpeRatio: sumSharpe / iterations,
        totalTrades: Math.round(sumTrades / iterations),
        winRate: sumWinRate / iterations,
      };

      // Optimize on a fixed seed path
      let optimizedParams = baseParams;
      let optimizedResult = bestResult!;

      if (optimize) {
        const rng = makeRng(42);
        const optPaths = new Map<string, number[]>();
        for (const [sym, cal] of calibrationData) {
          optPaths.set(sym, generatePricePath(cal.startPrice, cal.mu, cal.sigma, periodsPerIteration, rng));
        }
        const opt = optimizeParams(optPaths, baseParams, startingCapital);
        optimizedParams = opt.params;
        optimizedResult = opt.result;
      }

      const holdout = runSyntheticHoldout(calibrationData, optimizedParams, periodsPerIteration, startingCapital);
      const validation = {
        kind: "synthetic_unseen_seed", seed: 987654321,
        historicalOutOfSample: false, approvedForLive: false,
        warning: "GBM simulations do not establish a real trading edge. In-sample optimization results are not validation. Shorts are hypothetical; borrow/funding and market impact are not modeled.",
        costs: { feeBps: baseParams.feeBps, slippageBps: baseParams.slippageBps, assumedNotExchangeQuote: true },
        result: {
          finalEquity: holdout.finalEquity, totalReturnPct: holdout.totalReturnPct,
          maxDrawdownPct: holdout.maxDrawdownPct, sharpeRatio: holdout.sharpeRatio,
          totalTrades: holdout.totalTrades, winRate: holdout.winRate,
          netExpectancy: holdout.totalTrades ? (holdout.finalEquity - startingCapital) / holdout.totalTrades : null,
        },
      };

      // Store trades (limit 200)
      const sampleTrades = optimizedResult.trades.slice(0, 200);
      if (sampleTrades.length > 0) {
        const rows = sampleTrades.map((t) => ({
          run_id: runId, iteration: 0, symbol: t.symbol, side: t.side, strategy: t.strategy,
          entry_price: t.entryPrice, exit_price: t.exitPrice, pnl: t.pnl, pnl_pct: t.pnlPct,
          hold_periods: t.holdPeriods, exit_reason: t.exitReason, period: t.period,
        }));
        for (let i = 0; i < rows.length; i += 100) {
          const { error } = await supabase.from("backtest_trades").insert(rows.slice(i, i + 100));
          if (error) throw new Error("Unable to persist backtest trades");
        }
      }

      const { error: updateError } = await supabase.from("backtest_runs").update({
        final_equity: optimizedResult.finalEquity,
        total_return_pct: optimizedResult.totalReturnPct,
        annualized_return_pct: optimizedResult.annualizedReturnPct,
        max_drawdown_pct: optimizedResult.maxDrawdownPct,
        sharpe_ratio: optimizedResult.sharpeRatio,
        sortino_ratio: optimizedResult.sortinoRatio,
        total_trades: optimizedResult.totalTrades,
        winning_trades: optimizedResult.winningTrades,
        losing_trades: optimizedResult.losingTrades,
        win_rate: optimizedResult.winRate,
        avg_win: optimizedResult.avgWin, avg_loss: optimizedResult.avgLoss,
        profit_factor: optimizedResult.profitFactor,
        best_trade_pct: optimizedResult.bestTradePct,
        worst_trade_pct: optimizedResult.worstTradePct,
        avg_hold_periods: optimizedResult.avgHoldPeriods,
        strategy_params: { base: baseParams, optimized: optimizedParams, validation },
        equity_curve: optimizedResult.equityCurve,
        strategy_breakdown: optimizedResult.strategyBreakdown,
        status: "completed",
      }).eq("id", runId);
      if (updateError) throw new Error("Unable to persist backtest results");

      await supabase.from("audit_log").insert({
        event_type: "backtest_complete", entity_type: "backtest_runs", entity_id: runId,
        message: `${actualYears.toFixed(2)}yr SYNTHETIC in-sample stress test: ${optimizedResult.totalTrades} trades; NOT live validation`,
        metadata: { run_id: runId, years: actualYears, iterations, optimized: optimize },
      });

      return new Response(JSON.stringify({
        runId, years: actualYears, requestedYears: years, iterations, baseParams, optimizedParams, validation,
        optimized: {
          finalEquity: optimizedResult.finalEquity,
          totalReturnPct: optimizedResult.totalReturnPct,
          annualizedReturnPct: optimizedResult.annualizedReturnPct,
          maxDrawdownPct: optimizedResult.maxDrawdownPct,
          sharpeRatio: optimizedResult.sharpeRatio,
          sortinoRatio: optimizedResult.sortinoRatio,
          totalTrades: optimizedResult.totalTrades,
          winningTrades: optimizedResult.winningTrades,
          losingTrades: optimizedResult.losingTrades,
          winRate: optimizedResult.winRate,
          avgWin: optimizedResult.avgWin, avgLoss: optimizedResult.avgLoss,
          profitFactor: optimizedResult.profitFactor,
          bestTradePct: optimizedResult.bestTradePct,
          worstTradePct: optimizedResult.worstTradePct,
          avgHoldPeriods: optimizedResult.avgHoldPeriods,
          strategyBreakdown: optimizedResult.strategyBreakdown,
          equityCurve: optimizedResult.equityCurve,
        },
        monteCarlo: {
          best: { finalEquity: bestResult!.finalEquity, sharpeRatio: bestResult!.sharpeRatio, maxDrawdownPct: bestResult!.maxDrawdownPct },
          worst: { finalEquity: worstResult!.finalEquity, sharpeRatio: worstResult!.sharpeRatio, maxDrawdownPct: worstResult!.maxDrawdownPct },
          average: mcAvg,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "/results") {
      const { data: runs } = await supabase.from("backtest_runs").select("*").order("created_at", { ascending: false }).limit(10);
      return new Response(JSON.stringify({ runs: runs ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "/trades") {
      const runId = url.searchParams.get("runId");
      if (!runId) return new Response(JSON.stringify({ error: "Missing runId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: trades } = await supabase.from("backtest_trades").select("*").eq("run_id", runId).order("period", { ascending: true }).limit(500);
      return new Response(JSON.stringify({ trades: trades ?? [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown route. Use /run, /results, or /trades" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("backtest-engine error:", err);
    if (runId) await supabase.from("backtest_runs").update({ status: "failed" }).eq("id", runId);
    return new Response(JSON.stringify({ error: "Backtest failed; no live trading approval was issued" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
