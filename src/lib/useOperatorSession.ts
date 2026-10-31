import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { checkIsOperator } from '@/lib/operatorAuth';

export type OperatorStatus = 'loading' | 'signed-out' | 'signed-in' | 'operator';

export function useOperatorSession(): { status: OperatorStatus; email: string | null } {
  const [status, setStatus] = useState<OperatorStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const resolve = async (session: Session | null) => {
      if (!active) return;
      if (!session) {
        setEmail(null);
        setStatus('signed-out');
        return;
      }
      setEmail(session.user.email ?? null);
      try {
        const isOperator = await checkIsOperator();
        if (active) setStatus(isOperator ? 'operator' : 'signed-in');
      } catch {
        if (active) setStatus('signed-in');
      }
    };

    supabase.auth.getSession().then(({ data }) => { void resolve(data.session); });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => { await resolve(session); })();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return { status, email };
}
