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
const BINANCE_API_KEY = Deno.env.get("BINANCE_API_KEY")?.trim() ?? "";
const BINANCE_SECRET_KEY = Deno.env.get("BINANCE_SECRET_KEY")?.trim() ?? "";

async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Signed Binance.US API Call (multi-path) ───────────────────────

async function binanceSignedCall(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | unknown[]; raw: string; endpoint: string }> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    return { ok: false, status: 0, data: {}, raw: "Binance API credentials not configured", endpoint: "none" };
  }

  const timestamp = Date.now().toString();
  const allParams = { ...params, timestamp };
  const queryString = Object.entries(allParams)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const signature = await hmacSha256(BINANCE_SECRET_KEY, queryString);

  let fullBinanceUrl: string;
  let postBody: string | null = null;

  if (method === "POST") {
    postBody = `${queryString}&signature=${signature}`;
    fullBinanceUrl = `${BINANCE_BASE}${path}`;
  } else {
    fullBinanceUrl = `${BINANCE_BASE}${path}?${queryString}&signature=${signature}`;
  }

  // Attempt 1: Postgres http extension via RPC
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc("binance_http_call", {
      p_url: fullBinanceUrl,
      p_api_key: BINANCE_API_KEY,
      p_method: method,
      p_body: postBody,
    });
    if (!rpcError && rpcData) {
      const result = rpcData as { status_code: number; content: string; error: string | null };
      if (result.status_code > 0 && !result.content?.includes("IPv6 not supported")) {
        let data: Record<string, unknown> | unknown[] = {};
        try { data = JSON.parse(result.content); } catch { /* not json */ }
        return {
          ok: result.status_code >= 200 && result.status_code < 300,
          status: result.status_code,
          data,
          raw: result.content,
          endpoint: "pg-http",
        };
      }
    }
  } catch { /* fall through */ }

  // Attempt 2: Cloudflare Worker proxy
  const proxyUrl = Deno.env.get("BINANCE_PROXY_URL");
  const proxySecret = Deno.env.get("PROXY_SECRET");
  if (proxyUrl) {
    try {
      const headers: Record<string, string> = { "X-MBX-APIKEY": BINANCE_API_KEY };
      if (proxySecret) headers["X-Proxy-Secret"] = proxySecret;
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
      const proxyFullUrl = `${proxyUrl.replace(/\/$/, "")}${path}${method === "GET" ? `?${queryString}&signature=${signature}` : ""}`;
      const fetchOptions: RequestInit = { method, headers };
      if (postBody) fetchOptions.body = postBody;
      const res = await fetch(proxyFullUrl, fetchOptions);
      const rawBody = await res.text();
      if (res.status === 403 && rawBody.includes("CloudFront")) throw new Error("Proxy not deployed");
      let data: Record<string, unknown> | unknown[] = {};
      try { data = JSON.parse(rawBody); } catch { /* not json */ }
      return { ok: res.ok, status: res.status, data, raw: rawBody, endpoint: "cf-proxy" };
    } catch { /* fall through */ }
  }

  // Attempt 3: Direct fetch
  try {
    const headers: Record<string, string> = { "X-MBX-APIKEY": BINANCE_API_KEY };
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    const fetchOptions: RequestInit = { method, headers };
    if (postBody) fetchOptions.body = postBody;
    const res = await fetch(fullBinanceUrl, fetchOptions);
    const rawBody = await res.text();
    let data: Record<string, unknown> | unknown[] = {};
    try { data = JSON.parse(rawBody); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, data, raw: rawBody, endpoint: "direct" };
  } catch (err) {
    return { ok: false, status: 0, data: {}, raw: (err as Error).message, endpoint: "direct" };
  }
}

// ─── Symbol filters cache ──────────────────────────────────────────

let symbolFiltersCache: Map<string, { minQty: number; stepSize: number; minNotional: number }> | null = null;
let filtersCacheTime = 0;

async function getSymbolFilters(): Promise<Map<string, { minQty: number; stepSize: number; minNotional: number }>> {
  if (symbolFiltersCache && Date.now() - filtersCacheTime < 10 * 60 * 1000) return symbolFiltersCache;
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo`);
    const data = await res.json();
    const map = new Map<string, { minQty: number; stepSize: number; minNotional: number }>();
    for (const s of data.symbols ?? []) {
      const filters: Record<string, string> = {};
      for (const f of s.filters ?? []) {
        if (f.filterType === "LOT_SIZE") { filters.minQty = f.minQty; filters.stepSize = f.stepSize; }
        if (f.filterType === "MIN_NOTIONAL") { filters.minNotional = f.minNotional; }
      }
      map.set(s.symbol, {
        minQty: parseFloat(filters.minQty ?? "0"),
        stepSize: parseFloat(filters.stepSize ?? "0"),
        minNotional: parseFloat(filters.minNotional ?? "0"),
      });
    }
    symbolFiltersCache = map;
    filtersCacheTime = Date.now();
    return map;
  } catch {
    return symbolFiltersCache ?? new Map();
  }
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step) * step;
}

// ─── Get all non-USDT balances ──────────────────────────────────────

async function getNonUsdtBalances(): Promise<{ coin: string; free: number }[]> {
  const result = await binanceSignedCall("/sapi/v1/capital/config/getall", {});
  if (!result.ok) return [];
  const coins = result.data as Array<{ coin: string; free: string; locked: string }>;
  return coins
    .filter((c) => c.coin !== "USDT" && parseFloat(c.free) > 0)
    .map((c) => ({ coin: c.coin, free: parseFloat(c.free) }));
}

async function getUsdtBalance(): Promise<number> {
  const result = await binanceSignedCall("/sapi/v1/capital/config/getall", {});
  if (!result.ok) return 0;
  const coins = result.data as Array<{ coin: string; free: string }>;
  const usdt = coins.find((c) => c.coin === "USDT");
  return usdt ? parseFloat(usdt.free) : 0;
}

// ─── Place spot sell order ──────────────────────────────────────────

async function spotSell(coin: string, quantity: number): Promise<{ orderId: string | null; error: string | null; proceeds: number }> {
  const symbol = `${coin}USDT`;
  const filters = await getSymbolFilters();
  const f = filters.get(symbol);
  if (!f) return { orderId: null, error: `No trading pair ${symbol}`, proceeds: 0 };

  let qty = roundToStep(quantity, f.stepSize);
  if (qty < f.minQty) return { orderId: null, error: `Quantity ${qty} below min ${f.minQty} for ${symbol}`, proceeds: 0 };

  let decimals = 6;
  if (f.stepSize > 0) {
    const stepStr = f.stepSize.toString();
    const dotIdx = stepStr.indexOf(".");
    decimals = dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0;
    while (decimals > 0 && stepStr[stepStr.length - 1] === "0") decimals--;
  }

  const params: Record<string, string> = {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: qty.toFixed(decimals),
    recvWindow: "10000",
    timestamp: Date.now().toString(),
  };
  const queryString = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
  const signature = await hmacSha256(BINANCE_SECRET_KEY, queryString);

  // Try via pg-http first, then direct
  const fullUrl = `${BINANCE_BASE}/api/v3/order`;
  const postBody = `${queryString}&signature=${signature}`;

  // pg-http
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc("binance_http_call", {
      p_url: fullUrl,
      p_api_key: BINANCE_API_KEY,
      p_method: "POST",
      p_body: postBody,
    });
    if (!rpcError && rpcData) {
      const result = rpcData as { status_code: number; content: string };
      if (result.status_code >= 200 && result.status_code < 300) {
        const order = JSON.parse(result.content);
        return { orderId: String(order.orderId), error: null, proceeds: Number(order.cummulativeQuoteQty ?? 0) };
      }
      const errBody = JSON.parse(result.content);
      return { orderId: null, error: (errBody.msg as string) ?? `Order failed (${result.status_code})`, proceeds: 0 };
    }
  } catch { /* fall through */ }

  // Direct
  try {
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: { "X-MBX-APIKEY": BINANCE_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: postBody,
    });
    const raw = await res.text();
    if (res.ok) {
      const order = JSON.parse(raw);
      return { orderId: String(order.orderId), error: null, proceeds: Number(order.cummulativeQuoteQty ?? 0) };
    }
    const errBody = JSON.parse(raw);
    return { orderId: null, error: (errBody.msg as string) ?? `Order failed (${res.status})`, proceeds: 0 };
  } catch (err) {
    return { orderId: null, error: (err as Error).message, proceeds: 0 };
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/binance-withdraw", "");

    // ─── Diagnostic ──────────────────────────────────────────────
    if (path === "/test") {
      const results: Record<string, unknown> = {
        api_key_set: !!BINANCE_API_KEY,
        secret_key_set: !!BINANCE_SECRET_KEY,
        proxy_url_set: !!Deno.env.get("BINANCE_PROXY_URL"),
      };

      try {
        const pr = await fetch(`${BINANCE_BASE}/api/v3/ping`);
        results.ping = { status: pr.status };
      } catch (e) {
        results.ping = { error: (e as Error).message };
      }

      const testResult = await binanceSignedCall("/sapi/v1/capital/config/getall", {});
      results.final = {
        status: testResult.status,
        ok: testResult.ok,
        endpoint: testResult.endpoint,
        data: testResult.ok ? "API keys valid" : testResult.raw.slice(0, 300),
      };

      // Show non-USDT balances
      const balances = await getNonUsdtBalances();
      results.non_usdt_balances = balances;
      results.usdt_balance = await getUsdtBalance();

      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Account balance ──────────────────────────────────────────
    if (path === "/balance") {
      const result = await binanceSignedCall("/sapi/v1/capital/config/getall", {});
      if (!result.ok) {
        return new Response(JSON.stringify({
          ok: false,
          status: result.status,
          error: result.raw.slice(0, 300),
          endpoint: result.endpoint,
        }), {
          status: result.status || 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const coins = result.data as Array<{
        coin: string; name: string; free: string; locked: string; freeze: string; withdrawing: string;
        depositAllEnable: boolean; withdrawAllEnable: boolean;
        networkList: Array<{ network: string; withdrawEnable: boolean; depositEnable: boolean; withdrawFee: string; withdrawMin: string }>;
      }>;

      const nonZero = coins
        .filter((c) => parseFloat(c.free) > 0 || parseFloat(c.locked) > 0 || parseFloat(c.freeze) > 0 || parseFloat(c.withdrawing) > 0)
        .map((c) => ({
          coin: c.coin, name: c.name, free: c.free, locked: c.locked,
          withdrawing: c.withdrawing,
          networks: c.networkList?.map((n) => ({
            network: n.network, withdrawEnabled: n.withdrawEnable, depositEnabled: n.depositEnable,
            withdrawFee: n.withdrawFee, withdrawMin: n.withdrawMin,
          })),
        }));

      return new Response(JSON.stringify({
        ok: true, endpoint: result.endpoint,
        totalCoins: coins.length, nonZeroBalances: nonZero, allZero: nonZero.length === 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── Routes listing ──────────────────────────────────────────
    if (path === "/routes") {
      const withdrawalId = url.searchParams.get("withdrawalId");
      if (!withdrawalId) {
        return new Response(JSON.stringify({ error: "withdrawalId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("withdrawal_routes")
        .select("*")
        .eq("withdrawal_id", withdrawalId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ routes: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "/routes/all") {
      const { data, error } = await supabase
        .from("withdrawal_routes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ routes: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Main collection: sell non-USDT coins to USDT ─────────────
    if (path === "" || path === "/") {
      const startTime = Date.now();
      const body = await req.json().catch(() => ({}));
      const withdrawalId = body.withdrawalId as string | undefined;

      // If withdrawalId provided, mark as processing
      if (withdrawalId) {
        const { data: withdrawal, error: wError } = await supabase
          .from("withdrawals")
          .select("*")
          .eq("id", withdrawalId)
          .maybeSingle();
        if (wError || !withdrawal) throw new Error("Collection record not found");
        if (withdrawal.status !== "pending") throw new Error(`Collection already ${withdrawal.status}`);
        await supabase.from("withdrawals")
          .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
          .eq("id", withdrawalId);
      }

      // Step 1: Get all non-USDT balances
      const balances = await getNonUsdtBalances();
      const usdtBefore = await getUsdtBalance();

      const sellResults: { coin: string; orderId: string | null; proceeds: number; error: string | null }[] = [];
      let totalProceeds = 0;
      let totalErrors = 0;

      // Step 2: Sell each non-USDT coin to USDT via spot market order
      for (const bal of balances) {
        const symbol = `${bal.coin}USDT`;
        const filters = await getSymbolFilters();
        const f = filters.get(symbol);

        // Skip if no trading pair or below minimum
        if (!f) {
          sellResults.push({ coin: bal.coin, orderId: null, proceeds: 0, error: `No ${symbol} trading pair` });
          totalErrors++;
          continue;
        }
        if (bal.free * 1 < f.minNotional && bal.free < f.minQty) {
          sellResults.push({ coin: bal.coin, orderId: null, proceeds: 0, error: `Balance too small to sell` });
          continue;
        }

        const result = await spotSell(bal.coin, bal.free);
        sellResults.push({
          coin: bal.coin,
          orderId: result.orderId,
          proceeds: result.proceeds,
          error: result.error,
        });
        if (result.error) totalErrors++;
        else totalProceeds += result.proceeds;
      }

      const usdtAfter = await getUsdtBalance();
      const usdtGained = usdtAfter - usdtBefore;
      const latencyMs = Date.now() - startTime;

      // Determine success: any sells that went through
      const successfulSells = sellResults.filter((s) => s.orderId !== null);
      const success = successfulSells.length > 0 || balances.length === 0;

      // Record the route
      if (withdrawalId) {
        await supabase.from("withdrawal_routes").insert({
          withdrawal_id: withdrawalId,
          strategy: "spot-sell",
          ai_model: "live",
          ai_reasoning: success
            ? `Sold ${successfulSells.length} coins to USDT via spot market orders (+$${usdtGained.toFixed(2)} USDT)`
            : `Spot sell failed: ${totalErrors} errors`,
          endpoints_tried: successfulSells.map((s) => `${s.coin}USDT`),
          endpoint_results: sellResults.map((s) => ({
            coin: s.coin, orderId: s.orderId, proceeds: s.proceeds, error: s.error,
          })),
          chosen_endpoint: "spot-market",
          rapidapi_used: false,
          latency_ms: latencyMs,
          success,
        });
      }

      if (success) {
        if (withdrawalId) {
          await supabase.from("withdrawals").update({
            status: "completed",
            tx_hash: `SPOT-${successfulSells.length}x-${Date.now().toString(36)}`,
            completed_at: new Date().toISOString(),
          }).eq("id", withdrawalId);
        }

        await supabase.from("audit_log").insert({
          event_type: "collection_completed",
          entity_type: "withdrawals",
          entity_id: withdrawalId ?? "manual",
          message: `Revenue collected via spot sell: ${successfulSells.length} coins sold, +$${usdtGained.toFixed(2)} USDT. USDT balance: $${usdtBefore.toFixed(2)} -> $${usdtAfter.toFixed(2)}`,
          metadata: {
            usdt_before: usdtBefore,
            usdt_after: usdtAfter,
            usdt_gained: usdtGained,
            coins_sold: successfulSells.map((s) => s.coin),
            coins_skipped: sellResults.filter((s) => !s.orderId).map((s) => ({ coin: s.coin, reason: s.error })),
            latency_ms: latencyMs,
          },
        });

        return new Response(JSON.stringify({
          success: true,
          status: "completed",
          strategy: "spot-sell",
          usdtBefore,
          usdtAfter,
          usdtGained,
          coinsSold: successfulSells.map((s) => ({ coin: s.coin, orderId: s.orderId, proceeds: s.proceeds })),
          coinsSkipped: sellResults.filter((s) => !s.orderId).map((s) => ({ coin: s.coin, reason: s.error })),
          latencyMs,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        if (withdrawalId) {
          await supabase.from("withdrawals").update({
            status: "failed",
            error_message: `Spot sell failed: ${sellResults.map((s) => `${s.coin}: ${s.error}`).join("; ")}`,
          }).eq("id", withdrawalId);
        }

        await supabase.from("audit_log").insert({
          event_type: "collection_failed",
          entity_type: "withdrawals",
          entity_id: withdrawalId ?? "manual",
          message: `Revenue collection failed: ${sellResults.map((s) => `${s.coin}: ${s.error}`).join("; ")}`,
          metadata: { errors: sellResults, latency_ms: latencyMs },
        });

        return new Response(JSON.stringify({
          success: false,
          error: sellResults.map((s) => `${s.coin}: ${s.error}`).join("; "),
          status: "failed",
          latencyMs,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── Transfer USDT to external wallet ───────────────────────
    if (path === "/transfer") {
      const body = await req.json().catch(() => ({}));
      const { address, network, amount } = body as { address: string; network: string; amount?: number };

      // Load from withdrawal_config if not provided
      let destAddress = address;
      let destNetwork = network;
      let transferAmount = amount;

      if (!destAddress || !destNetwork) {
        const { data: cfg } = await supabase
          .from("withdrawal_config")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        if (cfg) {
          destAddress = destAddress ?? cfg.destination_address;
          destNetwork = destNetwork ?? cfg.network;
        }
      }

      if (!destAddress || !destNetwork) {
        return new Response(JSON.stringify({
          success: false,
          error: "No destination address or network configured. Provide address + network in the request body or configure withdrawal_config.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Get current USDT balance
      const usdtBalance = await getUsdtBalance();
      if (usdtBalance < 1) {
        return new Response(JSON.stringify({
          success: false,
          error: `Insufficient USDT balance: ${usdtBalance.toFixed(4)}. Minimum $1 required for withdrawal.`,
          usdtBalance,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // If no amount specified, withdraw everything minus fee
      if (transferAmount === undefined || transferAmount === null) {
        transferAmount = usdtBalance;
      }

      if (transferAmount > usdtBalance) {
        return new Response(JSON.stringify({
          success: false,
          error: `Requested ${transferAmount} exceeds available USDT balance ${usdtBalance.toFixed(4)}`,
          usdtBalance,
          requested: transferAmount,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Place the withdrawal via Binance.US signed API
      const withdrawParams: Record<string, string> = {
        coin: "USDT",
        network: destNetwork,
        address: destAddress,
        amount: transferAmount.toFixed(8),
        recvWindow: "10000",
        timestamp: Date.now().toString(),
      };

      const result = await binanceSignedCall("/sapi/v1/capital/withdraw/apply", withdrawParams, "POST");

      if (!result.ok) {
        const errMsg = (result.data as Record<string, string>)?.msg ?? result.raw.slice(0, 300);
        await supabase.from("audit_log").insert({
          event_type: "withdrawal_failed",
          entity_type: "withdrawals",
          entity_id: "manual",
          message: `Withdrawal FAILED: ${transferAmount} USDT to ${destAddress.slice(0, 10)}... via ${destNetwork} — ${errMsg}`,
          metadata: { address: destAddress, network: destNetwork, amount: transferAmount, error: errMsg, status: result.status },
        });
        return new Response(JSON.stringify({
          success: false,
          error: errMsg,
          status: result.status,
          endpoint: result.endpoint,
          usdtBalance,
          requestedAmount: transferAmount,
        }), { status: result.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const withdrawId = (result.data as Record<string, string>)?.id ?? "unknown";

      await supabase.from("audit_log").insert({
        event_type: "withdrawal_completed",
        entity_type: "withdrawals",
        entity_id: withdrawId,
        message: `Withdrawal submitted: ${transferAmount} USDT to ${destAddress.slice(0, 10)}... via ${destNetwork} — ID: ${withdrawId}`,
        metadata: { address: destAddress, network: destNetwork, amount: transferAmount, withdrawId, binanceResponse: result.data },
      });

      return new Response(JSON.stringify({
        success: true,
        status: "submitted",
        withdrawId,
        amount: transferAmount,
        address: destAddress,
        network: destNetwork,
        usdtBalanceBefore: usdtBalance,
        message: `Withdrawal of ${transferAmount} USDT submitted to ${destAddress.slice(0, 10)}... via ${destNetwork}. Binance withdrawal ID: ${withdrawId}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown route. Use /balance, /transfer, /routes, or / (sweep)" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("binance-withdraw error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
