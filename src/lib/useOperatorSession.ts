import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { hasDatabaseAccess, supabase } from '@/lib/supabase';
import { checkIsOperator } from '@/lib/operatorAuth';

export type OperatorStatus = 'loading' | 'signed-out' | 'signed-in' | 'operator';

export function useOperatorSession(): { status: OperatorStatus; email: string | null } {
  const [status, setStatus] = useState<OperatorStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!hasDatabaseAccess) { setStatus('signed-out'); return; }
    let active = true;
    let revision = 0;

    const resolve = async (session: Session | null) => {
      const currentRevision = ++revision;
      if (!active) return;
      if (!session) {
        setEmail(null);
        setStatus('signed-out');
        return;
      }
      setEmail(session.user.email ?? null);
      try {
        const isOperator = await checkIsOperator();
        if (active && currentRevision === revision) setStatus(isOperator ? 'operator' : 'signed-in');
      } catch {
        if (active && currentRevision === revision) setStatus('signed-in');
      }
    };

    supabase.auth.getSession().then(({ data, error }) => { void resolve(error ? null : data.session); }).catch(() => { void resolve(null); });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      // Finish the auth callback before issuing another Supabase request.
      setTimeout(() => { if (active) void resolve(session); }, 0);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { status, email };
}
