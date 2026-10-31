import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

const DEFAULT_SYMBOLS = ["BCHUSDT", "LTCUSDT"];
const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}USDT$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function requireOperator(req: Request): Promise<Response | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return jsonResponse({ error: "Operator sign-in required" }, 401);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: "Operator sign-in required" }, 401);
  const { data: operator, error: opError } = await supabase
    .from("app_operators")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (opError) throw new Error(`Operator check failed: ${opError.message}`);
  if (!operator) return jsonResponse({ error: "This account is not authorized to view the exchange account" }, 403);
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

async function getAccount(): Promise<Response> {
  const account = await signedGet("/api/v3/account") as { balances?: { asset: string; free: string; locked: string }[] };
  const balances = (account.balances ?? [])
    .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
    .filter((b) => b.free > 0 || b.locked > 0);
  return jsonResponse({ ok: true, balances, fetchedAt: new Date().toISOString() });
}

async function getOrders(url: URL): Promise<Response> {
  const requested = url.searchParams.get("symbols");
  const symbols = requested ? requested.split(",").map((s) => s.trim().toUpperCase()) : DEFAULT_SYMBOLS;
  if (symbols.length === 0 || symbols.length > 5 || !symbols.every((s) => SYMBOL_PATTERN.test(s))) {
    return jsonResponse({ error: "Invalid symbol list" }, 400);
  }

  const results = await Promise.all(symbols.map(async (symbol) => {
    const [orders, trades] = await Promise.all([
      signedGet("/api/v3/allOrders", { symbol, limit: "50" }) as Promise<Record<string, unknown>[]>,
      signedGet("/api/v3/myTrades", { symbol, limit: "100" }) as Promise<Record<string, unknown>[]>,
    ]);
    return { symbol, orders, trades };
  }));

  return jsonResponse({ ok: true, symbols: results, fetchedAt: new Date().toISOString() });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const denied = await requireOperator(req);
    if (denied) return denied;

    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "").split("/").pop();

    if (route === "account") return await getAccount();
    if (route === "orders") return await getOrders(url);
    return jsonResponse({ error: "Unknown route" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonResponse({ ok: false, error: message }, 502);
  }
});
