import { collectHistorySymbols, mapInBatches, SYMBOL_PATTERN } from "./history.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BINANCE_BASE = "https://api.binance.us";
const BINANCE_API_KEY = Deno.env.get("BINANCE_API_KEY_3")?.trim() ?? "";
const BINANCE_SECRET_KEY = Deno.env.get("BINANCE_SECRET_KEY_3")?.trim() ?? "";


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return null;
  return fwd.split(",")[0].trim() || null;
}

function logIntruder(req: Request, route: string, reason: string, detail?: string): void {
  const ip = clientIp(req);
  void supabase.from("intruder_events").insert({
    function_name: "binance-account",
    route,
    method: req.method,
    client_ip: ip,
    reason,
    detail: detail ?? null,
  }).then(
    () => {},
    (err) => console.error("intruder_events insert failed:", err?.message ?? err),
  );
}

async function requireOperator(req: Request, route: string): Promise<Response | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    logIntruder(req, route, "no_token", "Missing Authorization header");
    return jsonResponse({ error: "Operator sign-in required" }, 401);
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    logIntruder(req, route, "invalid_token", "Token rejected by auth");
    return jsonResponse({ error: "Operator sign-in required" }, 401);
  }
  const { data: operator, error: opError } = await supabase
    .from("app_operators")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (opError) throw new Error(`Operator check failed: ${opError.message}`);
  if (!operator) {
    logIntruder(req, route, "not_operator", `Signed-in user ${userData.user.id} is not an operator`);
    return jsonResponse({ error: "This account is not authorized to view the exchange account" }, 403);
  }
  return null;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
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

async function signedGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) throw new Error("Binance API keys are not configured");
  const query = new URLSearchParams({ ...params, recvWindow: "10000", timestamp: Date.now().toString() });
  const signature = await hmacSha256Hex(BINANCE_SECRET_KEY, query.toString());
  query.set("signature", signature);
  const res = await fetch(`${BINANCE_BASE}${path}?${query.toString()}`, {
    headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* handled below */ }
  if (!res.ok) {
    const msg = (data as { msg?: string } | null)?.msg ?? text.slice(0, 200);
    throw new Error(`Binance returned ${res.status}: ${msg}`);
  }
  return data;
}

interface Balance { asset: string; free: number; locked: number }
interface ExchangeOrder { symbol: string; orderId: number; [key: string]: unknown }

async function readAccount() {
  const account = await signedGet("/api/v3/account") as { canTrade?: boolean; balances?: { asset: string; free: string; locked: string }[] };
  if (!Array.isArray(account.balances)) throw new Error("Exchange balance response was incomplete");
  const balances: Balance[] = account.balances.map(b => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }));
  if (balances.some(b => !Number.isFinite(b.free) || !Number.isFinite(b.locked))) throw new Error("Exchange returned an invalid balance");
  return { balances: balances.filter(b => b.free > 0 || b.locked > 0), canTrade: account.canTrade === true };
}

async function getAccount(): Promise<Response> {
  return jsonResponse({ ok: true, ...await readAccount(), fetchedAt: new Date().toISOString() });
}

async function getOverview(): Promise<Response> {
  const [account, ordersResult, tradesResult, configuredResult, entryAttempts] = await Promise.all([
    readAccount(),
    signedGet("/api/v3/openOrders").then(data => {
      if (!Array.isArray(data)) throw new Error("Exchange open-order response was incomplete");
      return { data: data as ExchangeOrder[], error: null as string | null };
    }).catch(error => ({ data: [] as ExchangeOrder[], error: error instanceof Error ? error.message : "Open orders unavailable" })),
    supabase.from("paper_trades")
      .select("id,symbol,status,quantity,remaining_quantity,closed_at,binance_order_id,binance_close_order_id,execution_error")
      .eq("is_live", true).order("opened_at", { ascending: false }).limit(1000),
    supabase.from("bot_pair_allowlist").select("symbol").eq("enabled", true).limit(1000),
    supabase.from("live_entry_attempts").select("symbol,state,entry_order_id,created_at")
      .in("state", ["claimed", "reconciliation_required"]).order("created_at", { ascending: false }).limit(100),
  ]);
  const warnings: string[] = [];
  if (tradesResult.error) warnings.push("Tracked trade history is unavailable; reconciliation could not be checked.");
  if (configuredResult.error) warnings.push("Configured trading pairs are unavailable.");
  if (ordersResult.error) warnings.push(ordersResult.error);
  if (entryAttempts.error) warnings.push("Pending entry attempts could not be checked. Apply the matching backend migration before relying on reconciliation.");
  if (entryAttempts.data?.length) warnings.push(`Entry confirmation requires review for ${[...new Set(entryAttempts.data.map(row => row.symbol))].join(', ')}. Confirm exchange fills before clearing the entry claim.`);
  const tracked = tradesResult.data ?? [];
  if (tracked.length === 1000) warnings.push("Pair discovery covers the latest 1,000 tracked trades.");
  const universe = collectHistorySymbols({
    held: account.balances.map(b => b.asset),
    openOrders: ordersResult.data.map(order => order.symbol),
    configured: (configuredResult.data ?? []).map(row => row.symbol),
    tracked: [...tracked.map(row => row.symbol), ...(entryAttempts.data ?? []).map(row => row.symbol)],
  });
  const reconciliationCandidates = tracked
    .filter(row => row.status === "closed" && row.binance_order_id && !row.binance_close_order_id)
    .map(row => {
      const asset = row.symbol.endsWith("USDT") ? row.symbol.slice(0, -4) : null;
      const balance = account.balances.find(b => b.asset === asset);
      return {
        id: row.id, symbol: row.symbol, quantity: Number(row.remaining_quantity ?? row.quantity),
        closedAt: row.closed_at, buyOrderId: row.binance_order_id,
        exchangeBalance: asset ? (balance?.free ?? 0) + (balance?.locked ?? 0) : null,
      };
    }).filter(row => row.exchangeBalance === null || row.exchangeBalance > 0);
  return jsonResponse({
    ok: true, ...account, ...universe, openOrders: ordersResult.error ? null : ordersResult.data,
    reconciliationCandidates, reconciliationChecked: !tradesResult.error,
    warnings, fetchedAt: new Date().toISOString(),
  });
}

async function getOrders(url: URL): Promise<Response> {
  const requested = url.searchParams.get("symbols");
  // Explicit symbols keep each read bounded and prevent silently looking at only BCH/LTC.
  if (!requested) return jsonResponse({ error: "Choose symbols from /overview before requesting order history" }, 400);
  const symbols = [...new Set(requested.split(",").map(s => s.trim().toUpperCase()))];
  if (symbols.length === 0 || symbols.length > 5 || !symbols.every(s => SYMBOL_PATTERN.test(s))) {
    return jsonResponse({ error: "Choose between 1 and 5 USDT pairs" }, 400);
  }
  const results = await mapInBatches(symbols, 2, async symbol => {
    try {
      const [orders, trades] = await Promise.all([
        signedGet("/api/v3/allOrders", { symbol, limit: "50" }),
        signedGet("/api/v3/myTrades", { symbol, limit: "1000" }),
      ]);
      if (!Array.isArray(orders) || !Array.isArray(trades)) throw new Error("Exchange history response was incomplete");
      return { symbol, orders, trades, ordersMayBeTruncated: orders.length === 50, tradesMayBeTruncated: trades.length === 1000, error: null };
    } catch (error) {
      return { symbol, error: error instanceof Error ? error.message : "History unavailable" };
    }
  });
  return jsonResponse({
    ok: true, symbols: results.filter(row => !row.error),
    errors: results.filter(row => row.error).map(row => ({ symbol: row.symbol, error: row.error })),
    fetchedAt: new Date().toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "").split("/").pop();
    const denied = await requireOperator(req, route ?? "unknown");
    if (denied) return denied;

    if (route === "overview") return await getOverview();
    if (route === "account") return await getAccount();
    if (route === "orders") return await getOrders(url);
    return jsonResponse({ error: "Unknown route" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonResponse({ ok: false, error: message }, 502);
  }
});
