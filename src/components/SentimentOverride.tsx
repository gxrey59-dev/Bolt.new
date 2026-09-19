import { useState } from 'react';
import { Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { setSentiment } from '@/lib/engine';
import type { Sentiment } from '@/lib/types';

interface Props {
  sentiment: Sentiment | null;
}

export default function SentimentOverride({ sentiment }: Props) {
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<'bullish' | 'bearish' | 'neutral'>(
    sentiment?.mode ?? 'neutral'
  );

  const handleEngage = async () => {
    setLoading(true);
    try {
      await setSentiment(selected);
    } finally {
      setLoading(false);
    }
  };

  const modes = [
    { value: 'bullish' as const, label: 'Bullish', icon: TrendingUp, color: 'emerald' },
    { value: 'bearish' as const, label: 'Bearish', icon: TrendingDown, color: 'red' },
    { value: 'neutral' as const, label: 'Neutral', icon: Minus, color: 'zinc' },
  ];

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Gauge className="h-5 w-5 text-purple-400" />
        <h2 className="text-base font-semibold text-zinc-200">Sentiment Override</h2>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        {sentiment && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-zinc-500">Current:</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                sentiment.mode === 'bullish'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : sentiment.mode === 'bearish'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-zinc-700/40 text-zinc-400'
              }`}
            >
              {sentiment.mode}
            </span>
          </div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-2">
          {modes.map(m => {
            const Icon = m.icon;
            const isSelected = selected === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setSelected(m.value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all ${
                  isSelected
                    ? m.color === 'emerald'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : m.color === 'red'
                        ? 'border-red-500/50 bg-red-500/10 text-red-400'
                        : 'border-zinc-600 bg-zinc-800/60 text-zinc-300'
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                }`}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleEngage}
          disabled={loading}
          className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
        >
          {loading ? 'Engaging...' : 'Engage Override'}
        </button>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          Bullish boosts all factions 1.3x except Inspectah Deck (0.5x hedge). 
          Bearish reduces to 0.6x except Inspectah (1.5x inverted defense).
        </p>
      </div>
    </section>
  );
}
