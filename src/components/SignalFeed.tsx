import { Radio, Brain, TrendingUp, TrendingDown } from 'lucide-react';
import { FACTIONS } from '@/lib/constants';
import type { Signal } from '@/lib/types';

interface Props {
  signals: Signal[];
}

const typeColors: Record<string, string> = {
  buy: 'text-emerald-400',
  sell: 'text-red-400',
  arbitrage: 'text-blue-400',
  liquidation: 'text-orange-400',
  bridge: 'text-cyan-400',
  stake: 'text-amber-400',
  unstake: 'text-zinc-400',
};

const strategyColors: Record<string, string> = {
  rsi_oversold: 'text-emerald-400',
  rsi_overbought: 'text-red-400',
  macd_crossover: 'text-blue-400',
  momentum_breakout: 'text-amber-400',
  mean_reversion: 'text-cyan-400',
};

export default function SignalFeed({ signals }: Props) {
  const recent = signals.slice(0, 40);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Live Signal Feed</h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          {signals.length} signals
        </span>
      </div>
      <div className="h-64 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-1">
        {recent.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-600">
            Waiting for strategy signals...
          </p>
        ) : (
          <div className="space-y-0.5">
            {recent.map(s => {
              const faction = FACTIONS.find(f => f.id === s.faction_id);
              const payload = s.payload as Record<string, unknown>;
              const strategy = payload?.strategy as string | undefined;
              const reasoning = payload?.reasoning as string | undefined;
              const rsi = payload?.rsi as number | undefined;
              const strength = payload?.strength as number | undefined;
              const isExecuted = s.status === 'executed';

              return (
                <div
                  key={s.id}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800/40 ${
                    isExecuted ? 'border-l-2 border-emerald-500/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-12 font-mono font-semibold uppercase ${typeColors[s.signal_type] ?? 'text-zinc-400'}`}>
                      {s.signal_type}
                    </span>
                    <span className="w-14 font-mono text-zinc-300">{s.token_symbol}</span>
                    <span className="w-20 truncate text-zinc-500">{faction?.name ?? s.faction_id}</span>
                    {strategy && (
                      <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${strategyColors[strategy] ?? 'text-zinc-500'}`}>
                        <Brain className="h-2.5 w-2.5" />
                        {strategy.replace(/_/g, ' ')}
                      </span>
                    )}
                    {rsi !== undefined && (
                      <span className={`font-mono text-[10px] tabular-nums ${rsi < 30 ? 'text-emerald-400' : rsi > 70 ? 'text-red-400' : 'text-zinc-500'}`}>
                        RSI {rsi.toFixed(1)}
                      </span>
                    )}
                    {isExecuted && (
                      <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold text-emerald-400">
                        PAPER
                      </span>
                    )}
                    <span className="ml-auto font-mono tabular-nums text-zinc-600">{s.latency_ms}ms</span>
                  </div>
                  {reasoning && (
                    <p className="mt-0.5 pl-[3.5rem] text-[10px] leading-snug text-zinc-600 line-clamp-1">
                      {reasoning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
