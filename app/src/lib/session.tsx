import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api, ApiError } from './api';
import type { Bootstrap } from './types';

interface Ctx {
  session: Session | null;
  boot: Bootstrap | null;
  loading: boolean;
  error: string | null;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
  setBoot: (b: Bootstrap) => void;
  signOut: () => Promise<void>;
  /** true while the user is setting a new password after a reset code */
  recovery: boolean;
  setRecovery: (v: boolean) => void;
}

const SessionCtx = createContext<Ctx>(null as unknown as Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecoveryState] = useState(() => sessionStorage.getItem('vc.recovery') === '1');
  const setRecovery = (v: boolean) => { v ? sessionStorage.setItem('vc.recovery', '1') : sessionStorage.removeItem('vc.recovery'); setRecoveryState(v); };

  const load = useCallback(async () => {
    try {
      setError(null);
      setBoot(await api.bootstrap());
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VC401') await supabase.auth.signOut();
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await load();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') setBoot(null);
      if (event === 'SIGNED_IN') { setLoading(true); load().finally(() => setLoading(false)); }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value: Ctx = {
    session, boot, loading, error,
    can: (p) => !!boot?.permissions?.includes(p),
    refresh: load,
    setBoot,
    signOut: async () => { setRecovery(false); await supabase.auth.signOut(); setBoot(null); },
    recovery, setRecovery
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);
