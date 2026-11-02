import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  createPublicClient, createWalletClient, encodeFunctionData, fallback, http, keccak256, parseAbi, type Hex,
} from "npm:viem@2.21.55";
import { privateKeyToAccount } from "npm:viem@2.21.55/accounts";
import { polygon } from "npm:viem@2.21.55/chains";
import { POLYGON_RPCS, TOKENS } from "./chain.ts";

const MIN_SWEEP_USD = 5;
const COLD_ADDRESS_DELAY_MS = 24 * 60 * 60 * 1000;
const UNSIGNED_TIMEOUT_MS = 5 * 60 * 1000;
const UNSEEN_TX_TIMEOUT_MS = 30 * 60 * 1000;
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const transport = fallback(POLYGON_RPCS.map((url) => http(url, { timeout: 10_000 })));
const publicClient = createPublicClient({ chain: polygon, transport });

type Wallet = {
  address: string;
  max_action_usd: number;
  daily_cap_usd: number;
  auto_withdraw_enabled: boolean;
  cold_address: string | null;
  cold_address_set_at: string | null;
  keep_reserve_usd: number;
};
type Spend = { id: string; created_at: string; tx_hash: string | null; status: string; amount_usd: number; token: string; to_address: string };

async function finishRun(supabase: SupabaseClient, result: string) {
  await supabase.from("defi_swarm_wallet").update({ last_run_at: new Date().toISOString(), last_run_result: result }).eq("id", 1);
  return { result };
}

async function markSpend(supabase: SupabaseClient, id: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from("defi_swarm_spends").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`Spend update failed: ${error.message}`);
}

async function logSpend(supabase: SupabaseClient, spend: Spend, outcome: "confirmed" | "failed", detail: string) {
  await supabase.from("audit_log").insert({
    event_type: outcome === "confirmed" ? "swarm_sweep_confirmed" : "swarm_sweep_failed",
    entity_type: "defi_swarm_spends",
    entity_id: spend.id,
    message: `Swarm sweep ${outcome}: ${spend.amount_usd} ${spend.token} to ${spend.to_address.slice(0, 10)}... ${detail}`,
    metadata: { tx_hash: spend.tx_hash, amount_usd: spend.amount_usd, token: spend.token, to: spend.to_address },
  });
}

async function reconcile(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("defi_swarm_spends")
    .select("id, created_at, tx_hash, status, amount_usd, token, to_address")
    .in("status", ["reserved", "submitted"]);
  if (error) throw new Error(`Spend lookup failed: ${error.message}`);
  let open = 0;
  for (const spend of (data ?? []) as Spend[]) {
    const age = Date.now() - new Date(spend.created_at).getTime();
    if (!spend.tx_hash) {
      if (age > UNSIGNED_TIMEOUT_MS) await markSpend(supabase, spend.id, { status: "failed", error: "Never signed or sent" });
      else open++;
      continue;
    }
    const receipt = await publicClient.getTransactionReceipt({ hash: spend.tx_hash as Hex }).catch(() => null);
    if (receipt) {
      const ok = receipt.status === "success";
      await markSpend(supabase, spend.id, { status: ok ? "confirmed" : "failed", error: ok ? null : "Transaction reverted on-chain" });
      await logSpend(supabase, spend, ok ? "confirmed" : "failed", `tx ${spend.tx_hash}`);
      continue;
    }
    const pending = await publicClient.getTransaction({ hash: spend.tx_hash as Hex }).catch(() => null);
    if (!pending && age > UNSEEN_TX_TIMEOUT_MS) {
      await markSpend(supabase, spend.id, { status: "failed", error: "Transaction never reached the network" });
      await logSpend(supabase, spend, "failed", "never reached the network");
    } else {
      open++;
    }
  }
  return open;
}

const reserveErrors: Record<string, string> = {
  per_action_limit: "Blocked: amount is above the per-action limit",
  daily_cap: "Daily cap reached; waiting for the 24-hour window to free up",
  spend_in_flight: "Waiting for the previous transfer to finish",
};

export async function runSweepWorker(supabase: SupabaseClient) {
  const { data: wallet, error } = await supabase
    .from("defi_swarm_wallet")
    .select("address, max_action_usd, daily_cap_usd, auto_withdraw_enabled, cold_address, cold_address_set_at, keep_reserve_usd")
    .eq("id", 1)
    .maybeSingle<Wallet>();
  if (error) throw new Error(`Wallet lookup failed: ${error.message}`);
  if (!wallet) return { result: "No swarm wallet" };

  if (await reconcile(supabase) > 0) return finishRun(supabase, "Waiting for the previous transfer to confirm");
  if (!wallet.auto_withdraw_enabled) return finishRun(supabase, "Auto-withdraw is off");
  if (!wallet.cold_address) return finishRun(supabase, "No cold storage address set");
  if (wallet.cold_address.toLowerCase() === wallet.address.toLowerCase()) return finishRun(supabase, "Cold address cannot be the swarm wallet");
  const setAt = wallet.cold_address_set_at ? new Date(wallet.cold_address_set_at).getTime() : Date.now();
  if (Date.now() - setAt < COLD_ADDRESS_DELAY_MS) return finishRun(supabase, "New cold address is in its 24-hour safety delay");

  const owner = wallet.address as Hex;
  const balances = await Promise.all(TOKENS.map(async (t) => ({
    ...t,
    raw: await publicClient.readContract({ address: t.address, abi: erc20, functionName: "balanceOf", args: [owner] }),
  })));
  const totalCents = balances.reduce((sum, b) => sum + b.raw / 10_000n, 0n);
  const sweepableCents = totalCents - BigInt(Math.round(Number(wallet.keep_reserve_usd) * 100));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from("defi_swarm_spends")
    .select("amount_usd")
    .in("status", ["reserved", "submitted", "confirmed"])
    .gt("created_at", since);
  if (recentError) throw new Error(`Spend history failed: ${recentError.message}`);
  const spentCents = (recent ?? []).reduce((sum, r) => sum + BigInt(Math.round(Number(r.amount_usd) * 100)), 0n);
  const remainingCents = BigInt(Math.round(Number(wallet.daily_cap_usd) * 100)) - spentCents;

  const token = balances.reduce((best, b) => (b.raw > best.raw ? b : best));
  const candidates = [sweepableCents, remainingCents, BigInt(Math.round(Number(wallet.max_action_usd) * 100)), token.raw / 10_000n];
  const amountCents = candidates.reduce((min, v) => (v < min ? v : min));
  if (amountCents < BigInt(MIN_SWEEP_USD * 100)) {
    return finishRun(supabase, remainingCents < BigInt(MIN_SWEEP_USD * 100) ? reserveErrors.daily_cap : "Nothing above the reserve to sweep");
  }
  const amountRaw = amountCents * 10_000n;
  const amountUsd = Number(amountCents) / 100;

  const key = (await supabase.rpc("get_swarm_wallet_key")).data;
  if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Wallet key unavailable");
  const account = privateKeyToAccount(key as Hex);
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Wallet key does not match the swarm wallet");

  const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [wallet.cold_address as Hex, amountRaw] });
  const walletClient = createWalletClient({ account, chain: polygon, transport });
  const request = await walletClient.prepareTransactionRequest({ to: token.address, data, chain: polygon });
  const gasCost = (request.gas ?? 0n) * (request.maxFeePerGas ?? 0n);
  const pol = await publicClient.getBalance({ address: owner });
  if (pol < gasCost + gasCost / 5n) return finishRun(supabase, "Needs a little more POL to pay network fees");

  const { data: spendId, error: reserveError } = await supabase.rpc("reserve_swarm_spend", {
    p_kind: "sweep", p_token: token.symbol, p_token_address: token.address,
    p_amount_usd: amountUsd, p_amount_raw: amountRaw.toString(), p_to: wallet.cold_address,
  });
  if (reserveError || typeof spendId !== "string") {
    const code = Object.keys(reserveErrors).find((k) => reserveError?.message?.includes(k));
    return finishRun(supabase, code ? reserveErrors[code] : "Limit check failed; nothing was sent");
  }

  const serialized = await account.signTransaction(request);
  const hash = keccak256(serialized);
  await markSpend(supabase, spendId, { tx_hash: hash, status: "submitted" });

  try {
    await publicClient.sendRawTransaction({ serializedTransaction: serialized });
  } catch (err) {
    console.error("broadcast error", err);
    return finishRun(supabase, `Sent ${amountUsd} ${token.symbol}; broadcast unconfirmed, will verify on next run`);
  }

  const spend: Spend = { id: spendId, created_at: new Date().toISOString(), tx_hash: hash, status: "submitted", amount_usd: amountUsd, token: token.symbol, to_address: wallet.cold_address };
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 40_000 }).catch(() => null);
  if (!receipt) return finishRun(supabase, `Sent ${amountUsd} ${token.symbol}; waiting for confirmation`);
  const ok = receipt.status === "success";
  await markSpend(supabase, spendId, { status: ok ? "confirmed" : "failed", error: ok ? null : "Transaction reverted on-chain" });
  await logSpend(supabase, spend, ok ? "confirmed" : "failed", `tx ${hash}`);
  return finishRun(supabase, ok ? `Swept ${amountUsd} ${token.symbol} to cold storage` : "Transfer reverted on-chain; nothing moved");
}
