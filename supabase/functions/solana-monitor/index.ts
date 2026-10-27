import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Secret, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_BASE = "https://api.jup.ag/swap/v2";
const monitoredWallets = (Deno.env.get("SOLANA_SMART_WALLETS") ?? "")
  .split(",")
  .map((wallet) => wallet.trim())
  .filter(Boolean);
const monitoredPools = (Deno.env.get("SOLANA_LIQUIDITY_POOLS") ?? "")
  .split(",")
  .map((pool) => pool.trim())
  .filter(Boolean);
const webhookSecret = Deno.env.get("SOLANA_WEBHOOK_SECRET") ?? "";
const chronosUrl = Deno.env.get("CHRONOS_WEBHOOK_URL") ?? "";
const chronosSecret = Deno.env.get("CHRONOS_WEBHOOK_SECRET") ?? "";
const jupiterApiKey = Deno.env.get("JUPITER_API_KEY") ?? "";
const minCopyUsdc = positiveNumber(Deno.env.get("MIN_COPY_USDC"), 10);
const maxCopyUsdc = positiveNumber(Deno.env.get("MAX_COPY_USDC"), 25);
const maxPriceImpactBps = positiveNumber(Deno.env.get("MAX_PRICE_IMPACT_BPS"), 100);
const minYieldTvl = positiveNumber(Deno.env.get("MIN_YIELD_TVL_USD"), 1_000_000);
const minPoolImpactUsdc = positiveNumber(Deno.env.get("MIN_POOL_IMPACT_USDC"), 25_000);

type TokenTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number;
};

type HeliusTransaction = {
  signature?: string;
  timestamp?: number;
  description?: string;
  tokenTransfers?: TokenTransfer[];
};

type JupiterQuote = {
  router?: string;
  inAmount?: string;
  outAmount?: string;
  feeBps?: number;
  priceImpactPct?: string | number;
  error?: string;
  errorMessage?: string;
};

type YieldPool = {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  stablecoin?: boolean;
};

let yieldCache: { expires: number; rows: YieldPool[]; refreshedAt: string } | null = null;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function suppliedWebhookSecret(req: Request): string {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return req.headers.get("x-webhook-secret") ?? bearer;
}

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index++) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await fetch(url, { ...init, signal: controller.signal });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${result.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getJupiterQuote(inputMint: string, outputMint: string, amount: number): Promise<JupiterQuote> {
  const params = new URLSearchParams({ inputMint, outputMint, amount: Math.floor(amount).toString() });
  const headers: Record<string, string> = {};
  if (jupiterApiKey) headers["x-api-key"] = jupiterApiKey;
  const quote = await fetchJson(`${JUPITER_BASE}/order?${params.toString()}`, { headers });
  return quote as JupiterQuote;
}

async function getYieldPools(): Promise<{ rows: YieldPool[]; refreshedAt: string }> {
  if (yieldCache && yieldCache.expires > Date.now()) return yieldCache;
  const payload = await fetchJson("https://yields.llama.fi/pools", {}, 12_000) as { data?: YieldPool[] };
  const supportedProjects = new Set(["kamino-lend", "save"]);
  const rows = (payload.data ?? [])
    .filter((pool) => pool.chain === "Solana"
      && supportedProjects.has(pool.project)
      && pool.symbol === "USDC"
      && pool.stablecoin === true
      && Number(pool.tvlUsd) >= minYieldTvl
      && Number.isFinite(Number(pool.apy)))
    .sort((a, b) => Number(b.apy) - Number(a.apy))
    .slice(0, 8)
    .map((pool) => ({
      pool: pool.pool,
      chain: pool.chain,
      project: pool.project,
      symbol: pool.symbol,
      tvlUsd: Number(pool.tvlUsd),
      apy: Number(pool.apy),
      stablecoin: true,
    }));
  yieldCache = { rows, refreshedAt: new Date().toISOString(), expires: Date.now() + 5 * 60_000 };
  return yieldCache;
}

async function getPublicStatus(): Promise<Response> {
  const [quoteResult, yieldsResult, eventsResult] = await Promise.allSettled([
    getJupiterQuote(USDC_MINT, SOL_MINT, 100_000_000),
    getYieldPools(),
    supabase
      .from("solana_monitor_events")
      .select("event_type, signature, wallet, token_mint, usdc_amount, status, forwarded, chronos_status, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const yieldData = yieldsResult.status === "fulfilled"
    ? yieldsResult.value
    : { rows: [], refreshedAt: null };
  const recentEvents = eventsResult.status === "fulfilled" && !eventsResult.value.error
    ? eventsResult.value.data ?? []
    : [];
  const topYield = yieldData.rows[0] ?? null;
  const nextYield = yieldData.rows[1] ?? null;

  return response({
    mode: "guarded-signals",
    refreshedAt: new Date().toISOString(),
    configuration: {
      smartWalletCount: monitoredWallets.length,
      liquidityPoolCount: monitoredPools.length,
      smartMoneyReady: monitoredWallets.length > 0 && Boolean(webhookSecret),
      arbitrageReady: monitoredPools.length > 0 && Boolean(webhookSecret),
      chronosReady: Boolean(chronosUrl && chronosSecret),
      jupiterMode: jupiterApiKey ? "api-key" : "keyless-rate-limited",
      signerConnected: false,
      executionAuthorized: false,
      limits: { minCopyUsdc, maxCopyUsdc, maxPriceImpactBps, minYieldTvl, minPoolImpactUsdc },
    },
    engines: {
      smartMoney: monitoredWallets.length > 0 && webhookSecret ? "monitoring" : "configuration_required",
      arbitrage: monitoredPools.length > 0 && webhookSecret ? "monitoring" : "configuration_required",
      yield: yieldData.rows.length > 0 ? "monitoring" : "unavailable",
      chronos: chronosUrl && chronosSecret ? "armed" : "configuration_required",
    },
    jupiterQuote: quote ? {
      input: "100 USDC",
      outputMint: SOL_MINT,
      outAmount: quote.outAmount ?? null,
      router: quote.router ?? null,
      feeBps: quote.feeBps ?? null,
      priceImpactPct: quote.priceImpactPct ?? null,
    } : null,
    yieldMonitor: {
      source: "DefiLlama",
      refreshedAt: yieldData.refreshedAt,
      pools: yieldData.rows,
      topOpportunity: topYield ? {
        ...topYield,
        spreadToNextBps: nextYield ? Math.round((topYield.apy - nextYield.apy) * 100) : null,
      } : null,
    },
    recentEvents,
    errors: {
      quote: quoteResult.status === "rejected" ? String(quoteResult.reason) : null,
      yield: yieldsResult.status === "rejected" ? String(yieldsResult.reason) : null,
      events: eventsResult.status === "rejected"
        ? String(eventsResult.reason)
        : eventsResult.status === "fulfilled" && eventsResult.value.error
          ? eventsResult.value.error.message
          : null,
    },
  });
}

async function forwardToChronos(signal: Record<string, unknown>): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const result = await fetch(chronosUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${chronosSecret}`,
        "X-Signal-Mode": "guarded",
      },
      body: JSON.stringify(signal),
      signal: controller.signal,
    });
    return result.status;
  } finally {
    clearTimeout(timer);
  }
}

async function processSmartMoneyTransaction(transaction: HeliusTransaction) {
  const signature = transaction.signature?.trim();
  if (!signature) return { accepted: false, reason: "missing_signature" };
  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];

  for (const wallet of monitoredWallets) {
    const usdcSpent = transfers
      .filter((transfer) => transfer.mint === USDC_MINT && transfer.fromUserAccount === wallet)
      .reduce((total, transfer) => total + Number(transfer.tokenAmount ?? 0), 0);
    const purchased = transfers
      .filter((transfer) => transfer.mint && transfer.mint !== USDC_MINT && transfer.toUserAccount === wallet)
      .sort((a, b) => Number(b.tokenAmount ?? 0) - Number(a.tokenAmount ?? 0))[0];
    if (usdcSpent < minCopyUsdc || !purchased?.mint) continue;

    const copyUsdc = Math.min(usdcSpent, maxCopyUsdc);
    const basePayload = {
      observedAt: transaction.timestamp ? new Date(transaction.timestamp * 1000).toISOString() : new Date().toISOString(),
      description: transaction.description ?? null,
      observedUsdc: usdcSpent,
      guardedCopyUsdc: copyUsdc,
      limits: { minCopyUsdc, maxCopyUsdc, maxPriceImpactBps },
    };
    const { error: insertError } = await supabase.from("solana_monitor_events").insert({
      event_type: "smart_money_swap",
      signature,
      wallet,
      token_mint: purchased.mint,
      usdc_amount: usdcSpent,
      status: "observed",
      payload: basePayload,
    });
    if (insertError?.code === "23505") return { accepted: true, duplicate: true, signature };
    if (insertError) throw insertError;

    let quote: JupiterQuote | null = null;
    let status = "guarded";
    let forwarded = false;
    let chronosStatus: number | null = null;
    let rejectionReason: string | null = null;

    try {
      quote = await getJupiterQuote(USDC_MINT, purchased.mint, Math.round(copyUsdc * 1_000_000));
      const impact = Number(quote.priceImpactPct);
      const impactBps = Number.isFinite(impact) ? impact * 10_000 : null;
      if (!quote.outAmount) rejectionReason = "jupiter_returned_no_route";
      else if (impactBps === null) rejectionReason = "price_impact_unavailable";
      else if (impactBps > maxPriceImpactBps) rejectionReason = "price_impact_limit";
      else if (!chronosUrl || !chronosSecret) rejectionReason = "chronos_not_configured";
      else {
        chronosStatus = await forwardToChronos({
          version: 1,
          type: "smart_money_copy_signal",
          mode: "guarded-signal-only",
          signature,
          sourceWallet: wallet,
          inputMint: USDC_MINT,
          outputMint: purchased.mint,
          inputAmountAtomic: Math.round(copyUsdc * 1_000_000).toString(),
          maxPriceImpactBps,
          jupiterQuote: quote,
          executionAuthorized: false,
        });
        forwarded = chronosStatus >= 200 && chronosStatus < 300;
        status = forwarded ? "routed" : "failed";
        if (!forwarded) rejectionReason = `chronos_http_${chronosStatus}`;
      }
    } catch (error) {
      status = "failed";
      rejectionReason = error instanceof Error ? error.message : String(error);
    }

    if (rejectionReason && status !== "failed") status = "rejected";
    await supabase.from("solana_monitor_events").update({
      status,
      forwarded,
      chronos_status: chronosStatus,
      payload: { ...basePayload, quote, rejectionReason },
    }).eq("signature", signature);

    return { accepted: true, signature, status, forwarded, rejectionReason };
  }

  return { accepted: false, reason: "no_monitored_usdc_purchase" };
}

async function processPoolImpactTransaction(transaction: HeliusTransaction) {
  const signature = transaction.signature?.trim();
  if (!signature) return { accepted: false, reason: "missing_signature", engine: "pool_impact" };
  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];

  for (const pool of monitoredPools) {
    const usdcInflow = transfers
      .filter((transfer) => transfer.mint === USDC_MINT && transfer.toUserAccount === pool)
      .reduce((total, transfer) => total + Number(transfer.tokenAmount ?? 0), 0);
    if (usdcInflow < minPoolImpactUsdc) continue;

    const payload = {
      observedAt: transaction.timestamp ? new Date(transaction.timestamp * 1000).toISOString() : new Date().toISOString(),
      description: transaction.description ?? null,
      pool,
      usdcInflow,
      threshold: minPoolImpactUsdc,
    };
    const { error: insertError } = await supabase.from("solana_monitor_events").insert({
      event_type: "pool_impact",
      signature,
      wallet: pool,
      usdc_amount: usdcInflow,
      status: "observed",
      payload,
    });
    if (insertError?.code === "23505") {
      return { accepted: true, duplicate: true, signature, engine: "pool_impact" };
    }
    if (insertError) throw insertError;

    let status = "guarded";
    let forwarded = false;
    let chronosStatus: number | null = null;
    let rejectionReason: string | null = null;
    if (!chronosUrl || !chronosSecret) {
      status = "rejected";
      rejectionReason = "chronos_not_configured";
    } else {
      try {
        chronosStatus = await forwardToChronos({
          version: 1,
          type: "solana_pool_impact_signal",
          mode: "guarded-signal-only",
          signature,
          pool,
          usdcInflow,
          threshold: minPoolImpactUsdc,
          executionAuthorized: false,
        });
        forwarded = chronosStatus >= 200 && chronosStatus < 300;
        status = forwarded ? "routed" : "failed";
        if (!forwarded) rejectionReason = `chronos_http_${chronosStatus}`;
      } catch (error) {
        status = "failed";
        rejectionReason = error instanceof Error ? error.message : String(error);
      }
    }

    await supabase.from("solana_monitor_events").update({
      status,
      forwarded,
      chronos_status: chronosStatus,
      payload: { ...payload, rejectionReason },
    }).eq("event_type", "pool_impact").eq("signature", signature).eq("wallet", pool);
    return { accepted: true, signature, status, forwarded, rejectionReason, engine: "pool_impact" };
  }

  return { accepted: false, reason: "no_monitored_pool_impact", engine: "pool_impact" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/solana-monitor/, "") || "/";

  try {
    if (req.method === "GET" && (path === "/" || path === "/status")) {
      return await getPublicStatus();
    }

    if (req.method === "POST" && path === "/webhook/helius") {
      if (!webhookSecret) return response({ error: "Webhook ingestion is not configured." }, 503);
      if (!secretsMatch(suppliedWebhookSecret(req), webhookSecret)) {
        return response({ error: "Invalid webhook secret." }, 401);
      }
      if (monitoredWallets.length === 0 && monitoredPools.length === 0) {
        return response({ error: "No smart-money wallets or liquidity pools are configured." }, 503);
      }
      const body = await req.json();
      const transactions = Array.isArray(body) ? body as HeliusTransaction[] : [body as HeliusTransaction];
      const results = [];
      for (const transaction of transactions.slice(0, 100)) {
        if (monitoredWallets.length > 0) results.push(await processSmartMoneyTransaction(transaction));
        if (monitoredPools.length > 0) results.push(await processPoolImpactTransaction(transaction));
      }
      return response({ processed: results.length, results });
    }

    return response({ error: "Unknown route. Use GET /status or POST /webhook/helius." }, 404);
  } catch (error) {
    console.error("solana-monitor error", error);
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
