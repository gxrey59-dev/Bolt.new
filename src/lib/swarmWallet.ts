import { operatorFetch } from '@/lib/operatorAuth';

export interface SwarmWallet {
  address: string;
  chain: string;
  max_action_usd: number;
  daily_cap_usd: number;
  created_at: string;
  auto_withdraw_enabled: boolean;
  cold_address: string | null;
  cold_address_set_at: string | null;
  keep_reserve_usd: number;
  last_run_at: string | null;
  last_run_result: string | null;
}
export interface Balance { symbol: string; amount: string }
export interface Deposit { symbol: string; amount: string; hash: string; from: string; at: string }
export interface Spend {
  id: string;
  created_at: string;
  kind: string;
  token: string;
  amount_usd: number;
  to_address: string;
  tx_hash: string | null;
  status: 'reserved' | 'submitted' | 'confirmed' | 'failed';
  error: string | null;
}
export interface SwarmStatus {
  wallet: SwarmWallet | null;
  balances?: Balance[] | null;
  checkedAt?: string;
  source?: string;
  error?: string;
  deposits?: Deposit[] | null;
  depositsError?: string;
  spends?: Spend[];
  spent24h?: number;
}

export const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export async function callWallet(path: string, init?: RequestInit): Promise<SwarmStatus> {
  const res = await operatorFetch(`swarm-wallet/${path}`, init);
  const data = await res.json().catch(() => null) as (SwarmStatus & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? `Swarm wallet returned HTTP ${res.status}.`);
  if (data.wallet !== null && (typeof data.wallet !== 'object' || !addressPattern.test(data.wallet.address))) {
    throw new Error('The swarm wallet response was malformed.');
  }
  return data;
}

export function postWallet(path: string, body: unknown) {
  return callWallet(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
