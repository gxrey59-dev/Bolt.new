import { ShieldCheck } from 'lucide-react';

interface Props {
  email: string | null;
}

export default function OperatorStatusCard({ email }: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-100">Operator permissions active</p>
          <p className="text-xs text-zinc-400">{email ?? 'Signed in'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        <span className="text-xs text-zinc-500">Authorization level</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Operator
        </span>
      </div>
    </div>
  );
}
