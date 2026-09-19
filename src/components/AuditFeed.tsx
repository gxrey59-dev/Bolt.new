import { ScrollText } from 'lucide-react';
import type { AuditEntry } from '@/lib/types';

interface Props {
  entries: AuditEntry[];
}

const eventColors: Record<string, string> = {
  signal_batch: 'text-blue-400',
  cream_sweep: 'text-amber-400',
  circuit_breaker: 'text-red-400',
  failover: 'text-red-400',
  sentiment_override: 'text-purple-400',
  stress_test: 'text-orange-400',
  collection: 'text-cyan-400',
};

export default function AuditFeed({ entries }: Props) {
  const recent = entries.slice(0, 30);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Audit Log</h2>
        <span className="ml-auto text-xs text-zinc-500">{entries.length} events</span>
      </div>
      <div className="h-64 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-1">
        {recent.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-600">
            No events yet...
          </p>
        ) : (
          <div className="space-y-0.5">
            {recent.map(e => (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800/40"
              >
                <span className={`mt-0.5 w-24 shrink-0 font-mono font-semibold uppercase ${eventColors[e.event_type] ?? 'text-zinc-500'}`}>
                  {e.event_type.replace(/_/g, ' ')}
                </span>
                <span className="text-zinc-400 leading-relaxed">{e.message}</span>
                <span className="ml-auto shrink-0 font-mono tabular-nums text-zinc-600">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
