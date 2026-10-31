import { useCallback, useState } from 'react';
import { ArrowUpFromLine, CheckCircle2, ShieldAlert, Wallet, XCircle } from 'lucide-react';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { operatorFetch } from '@/lib/operatorAuth';
import { useVisibilityPolling } from '@/lib/useVisibilityPolling';
import type { AuditEntry } from '@/lib/types';

const MIN_WITHDRAWAL = 1;
const HISTORY_EVENTS = ['withdrawal_completed', 'withdrawal_failed'];

interface Destination { destination_address: string; network: string }
interface Result { success: boolean; message: string }

function truncateAddress(address: string) {
  return address.length > 16 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

export default function WithdrawalPanel() {
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destinationError, setDestinationError] = useState('');
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [amountInput, setAmountInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await operatorFetch('binance-withdraw/balance');
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.nonZeroBalances)) {
        throw new Error(data.error ?? `Vault connection returned HTTP ${res.status}.`);
      }
      const usdt = data.nonZeroBalances.find((b: { coin: string }) => b.coin === 'USDT');
      const free = usdt ? Number(usdt.free) : 0;
      if (!Number.isFinite(free) || free < 0) throw new Error('Invalid vault balance.');
      setVaultBalance(free);
      setBalanceError('');
    } catch (cause) {
      setVaultBalance(null);
      setBalanceError(cause instanceof Error ? cause.message : 'Vault balance unavailable.');
    }
  }, []);

  const fetchDestination = useCallback(async () => {
    const { data, error } = await supabase
      .from('withdrawal_config')
      .select('destination_address, network')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      setDestinationError(error.message);
      return;
    }
    if (!data?.destination_address || !data.network) {
      setDestination(null);
      setDestinationError('No withdrawal address is configured yet.');
      return;
    }
    setDestination(data as Destination);
    setDestinationError('');
  }, []);

  const fetchHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .in('event_type', HISTORY_EVENTS)
      .order('created_at', { ascending: false })
      .limit(15);
    if (!error) setHistory((data ?? []) as AuditEntry[]);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchBalance(), fetchDestination(), fetchHistory()]);
  }, [fetchBalance, fetchDestination, fetchHistory]);

  useVisibilityPolling(refresh, 15_000, hasDatabaseAccess);

  const amount = Number(amountInput);
  const amountError = !amountInput
    ? ''
    : !Number.isFinite(amount) || amount <= 0
      ? 'Enter a valid amount.'
      : amount < MIN_WITHDRAWAL
        ? `The minimum withdrawal is $${MIN_WITHDRAWAL.toFixed(2)}.`
        : vaultBalance !== null && amount > vaultBalance
          ? 'That is more than the available vault balance.'
          : '';
  const canReview = Boolean(amountInput) && !amountError && vaultBalance !== null && destination !== null && !sending;

  function handleAmountChange(value: string) {
    setAmountInput(value);
    setConfirming(false);
    setResult(null);
  }

  function fillMax() {
    if (vaultBalance === null) return;
    handleAmountChange((Math.floor(vaultBalance * 100) / 100).toFixed(2));
  }

  async function sendWithdrawal() {
    if (!destination) return;
    setSending(true);
    setResult(null);
    try {
      const res = await operatorFetch('binance-withdraw/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: destination.destination_address,
          network: destination.network,
          amount,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ success: true, message: data.message ?? 'Withdrawal submitted.' });
        setAmountInput('');
      } else {
        setResult({ success: false, message: data.error ?? `Withdrawal failed (HTTP ${res.status}).` });
      }
    } catch (cause) {
      setResult({ success: false, message: cause instanceof Error ? cause.message : 'Withdrawal request failed.' });
    } finally {
      setConfirming(false);
      setSending(false);
      await refresh();
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <ArrowUpFromLine className="h-5 w-5 text-emerald-400" />
        <h2 className="text-base font-semibold text-zinc-200">Vault Withdrawal</h2>
        <span className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-400">
          USDT only
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-zinc-300">Available in Vault</h3>
            </div>
            <p className="font-mono text-3xl font-bold tabular-nums text-amber-400">
              {vaultBalance !== null
                ? `$${vaultBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Free USDT on Binance.US that can be withdrawn. Locked funds are not included.
            </p>
            {balanceError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {balanceError}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">Destination</h3>
            {destination ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Network</span>
                  <span className="rounded bg-cyan-500/15 px-2 py-0.5 font-mono font-semibold text-cyan-400">{destination.network}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Address</span>
                  <span className="truncate font-mono text-zinc-300" title={destination.destination_address}>
                    {truncateAddress(destination.destination_address)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{destinationError || 'Loading destination...'}</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 lg:col-span-3">
          <h3 className="mb-4 text-sm font-semibold text-zinc-300">Send USDT</h3>

          <label htmlFor="withdraw-amount" className="mb-1.5 block text-xs text-zinc-400">Amount (USDT)</label>
          <div className="flex gap-2">
            <input
              id="withdraw-amount"
              type="number"
              inputMode="decimal"
              min={MIN_WITHDRAWAL}
              step="0.01"
              placeholder="0.00"
              value={amountInput}
              onChange={e => handleAmountChange(e.target.value)}
              disabled={sending}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              type="button"
              onClick={fillMax}
              disabled={vaultBalance === null || vaultBalance < MIN_WITHDRAWAL || sending}
              className="rounded-lg border border-zinc-700 px-4 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
            >
              Max
            </button>
          </div>
          {amountError && <p className="mt-2 text-xs text-red-400">{amountError}</p>}

          {result && (
            <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${
              result.success
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                : 'border-red-500/30 bg-red-500/5 text-red-400'
            }`}>
              {result.success
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                : <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
              <span>{result.message}</span>
            </div>
          )}

          <div className="mt-5">
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!canReview}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
              >
                Review Withdrawal
              </button>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="mb-3 flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                  <p className="text-xs leading-relaxed text-amber-300">
                    This sends {amount.toFixed(2)} USDT on {destination?.network} to {destination ? truncateAddress(destination.destination_address) : ''}.
                    Blockchain transfers cannot be reversed.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendWithdrawal}
                    disabled={sending}
                    className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Confirm Withdrawal'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="flex-1 rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">Withdrawal History</h3>
        {history.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">No withdrawals have been submitted yet.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {history.map(entry => {
              const ok = entry.event_type === 'withdrawal_completed';
              return (
                <div key={entry.id} className="flex items-start gap-3 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-zinc-800/40">
                  {ok
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
                    : <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />}
                  <p className="min-w-0 flex-1 break-words leading-relaxed text-zinc-300">{entry.message}</p>
                  <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
