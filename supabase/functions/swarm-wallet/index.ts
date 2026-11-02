import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { generatePrivateKey, privateKeyToAccount } from "npm:viem@2.21.55/accounts";

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

const POLYGON_RPCS = [
  "https://gateway.tenderly.co/public/polygon",
  "https://polygon-bor-rpc.publicnode.com",
  "https://1rpc.io/matic",
  "https://polygon.drpc.org",
];
const TOKENS = [
  { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
  { symbol: "USDC.e", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
  { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
];
const WALLET_COLUMNS = "address, chain, max_action_usd, daily_cap_usd, created_at, updated_at";
const POLYGONSCAN_API = "https://api.etherscan.io/v2/api";
const POLYGONSCAN_KEY = Deno.env.get("POLYGON_API_KEY")?.trim() ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function requireOperator(req: Request): Promise<{ userId: string } | Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return json({ error: "Operator sign-in required" }, 401);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Operator sign-in required" }, 401);
  const { data: operator, error: opError } = await supabase
    .from("app_operators")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (opError) throw new Error(`Operator check failed: ${opError.message}`);
  if (!operator) return json({ error: "This account is not authorized to manage the swarm wallet" }, 403);
  return { userId: userData.user.id };
}

async function rpc(endpoint: string, method: string, params: unknown[]): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  if (typeof body.result !== "string" || !/^0x[0-9a-f]*$/i.test(body.result)) throw new Error("Malformed RPC result");
  return body.result;
}

function formatUnits(raw: string, decimals: number): string {
  const value = BigInt(raw === "0x" ? "0x0" : raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
}

async function readBalances(address: string) {
  const padded = address.slice(2).toLowerCase().padStart(64, "0");
  let lastError = "No Polygon provider responded";
  for (const endpoint of POLYGON_RPCS) {
    try {
      const [native, ...tokens] = await Promise.all([
        rpc(endpoint, "eth_getBalance", [address, "latest"]),
        ...TOKENS.map((t) => rpc(endpoint, "eth_call", [{ to: t.address, data: `0x70a08231${padded}` }, "latest"])),
      ]);
      return {
        balances: [
          { symbol: "POL", amount: formatUnits(native, 18) },
          ...TOKENS.map((t, i) => ({ symbol: t.symbol, amount: formatUnits(tokens[i], t.decimals) })),
        ],
        checkedAt: new Date().toISOString(),
        source: new URL(endpoint).host,
      };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return { balances: null, error: `Balances unavailable: ${lastError}` };
}

type ScanTx = { hash: string; from: string; to: string; value: string; timeStamp: string; contractAddress?: string; isError?: string };

async function scanList(action: "txlist" | "tokentx", address: string): Promise<ScanTx[]> {
  const params = new URLSearchParams({
    chainid: "137", module: "account", action, address,
    page: "1", offset: "25", sort: "desc", apikey: POLYGONSCAN_KEY,
  });
  const res = await fetch(`${POLYGONSCAN_API}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`PolygonScan HTTP ${res.status}`);
  const body = await res.json() as { status?: string; message?: string; result?: unknown };
  if (Array.isArray(body.result)) return body.result as ScanTx[];
  if (body.message === "No transactions found") return [];
  throw new Error("PolygonScan rejected the request");
}

async function readDeposits(address: string) {
  if (!POLYGONSCAN_KEY) return { deposits: null, depositsError: "Deposit history is not configured" };
  try {
    const wallet = address.toLowerCase();
    const [native, tokens] = await Promise.all([scanList("txlist", address), scanList("tokentx", address)]);
    const known = new Map(TOKENS.map((t) => [t.address.toLowerCase(), t]));
    const deposits = [
      ...native
        .filter((tx) => tx.to?.toLowerCase() === wallet && tx.isError !== "1" && tx.value !== "0")
        .map((tx) => ({ symbol: "POL", amount: formatUnits(`0x${BigInt(tx.value).toString(16)}`, 18), tx })),
      ...tokens
        .filter((tx) => tx.to?.toLowerCase() === wallet && known.has(tx.contractAddress?.toLowerCase() ?? ""))
        .map((tx) => {
          const token = known.get(tx.contractAddress!.toLowerCase())!;
          return { symbol: token.symbol, amount: formatUnits(`0x${BigInt(tx.value).toString(16)}`, token.decimals), tx };
        }),
    ]
      .filter(({ tx }) => /^0x[0-9a-f]{64}$/i.test(tx.hash) && /^0x[0-9a-f]{40}$/i.test(tx.from))
      .map(({ symbol, amount, tx }) => ({ symbol, amount, hash: tx.hash, from: tx.from, at: new Date(Number(tx.timeStamp) * 1000).toISOString() }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 15);
    return { deposits };
  } catch (err) {
    console.error(err);
    return { deposits: null, depositsError: "Deposit history is temporarily unavailable" };
  }
}

async function getWallet() {
  const { data, error } = await supabase.from("defi_swarm_wallet").select(WALLET_COLUMNS).eq("id", 1).maybeSingle();
  if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
  return data;
}

async function createWallet(userId: string): Promise<Response> {
  if (await getWallet()) return json({ error: "A swarm wallet already exists" }, 409);

  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;

  const { data: secretId, error: vaultError } = await supabase.rpc("store_swarm_wallet_key", {
    p_secret: privateKey,
    p_name: `swarm_wallet_${address.toLowerCase()}`,
  });
  if (vaultError || typeof secretId !== "string") throw new Error("Could not store the wallet key securely");

  const { data, error } = await supabase
    .from("defi_swarm_wallet")
    .insert({ id: 1, address, chain: "polygon", vault_secret_id: secretId })
    .select(WALLET_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return json({ error: "A swarm wallet already exists" }, 409);
    throw new Error(`Wallet save failed: ${error.message}`);
  }

  await supabase.from("audit_log").insert({
    event_type: "swarm_wallet_created",
    entity_type: "defi_swarm_wallet",
    entity_id: address,
    message: `Dedicated swarm wallet created on Polygon: ${address}`,
    metadata: { address, chain: "polygon", created_by: userId },
  });

  return json({ wallet: data });
}

async function updateLimits(req: Request, userId: string): Promise<Response> {
  const body = await req.json().catch(() => null) as { max_action_usd?: unknown; daily_cap_usd?: unknown } | null;
  const maxAction = Number(body?.max_action_usd);
  const dailyCap = Number(body?.daily_cap_usd);
  if (!Number.isFinite(maxAction) || !Number.isFinite(dailyCap) || maxAction <= 0 || dailyCap <= 0) {
    return json({ error: "Limits must be positive numbers" }, 400);
  }
  if (maxAction > 100000 || dailyCap > 1000000) return json({ error: "Limits are above the allowed maximum" }, 400);
  if (maxAction > dailyCap) return json({ error: "The per-action limit cannot exceed the daily cap" }, 400);

  const { data, error } = await supabase
    .from("defi_swarm_wallet")
    .update({ max_action_usd: Math.round(maxAction * 100) / 100, daily_cap_usd: Math.round(dailyCap * 100) / 100, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select(WALLET_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Limit update failed: ${error.message}`);
  if (!data) return json({ error: "Create the swarm wallet first" }, 404);

  await supabase.from("audit_log").insert({
    event_type: "swarm_wallet_limits_updated",
    entity_type: "defi_swarm_wallet",
    entity_id: data.address,
    message: `Swarm wallet limits set: $${data.max_action_usd} per action, $${data.daily_cap_usd} per day`,
    metadata: { max_action_usd: data.max_action_usd, daily_cap_usd: data.daily_cap_usd, updated_by: userId },
  });

  return json({ wallet: data });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireOperator(req);
    if (auth instanceof Response) return auth;

    const path = new URL(req.url).pathname.replace(/^.*\/swarm-wallet/, "") || "/";

    if (req.method === "GET" && path === "/status") {
      const wallet = await getWallet();
      if (!wallet) return json({ wallet: null });
      const [balances, deposits] = await Promise.all([readBalances(wallet.address), readDeposits(wallet.address)]);
      return json({ wallet, ...balances, ...deposits });
    }
    if (req.method === "POST" && path === "/create") return await createWallet(auth.userId);
    if (req.method === "POST" && path === "/limits") return await updateLimits(req, auth.userId);

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Swarm wallet request failed. Please try again." }, 500);
  }
});
