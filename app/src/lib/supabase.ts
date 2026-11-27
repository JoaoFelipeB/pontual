import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key && !url.includes('SEU-PROJETO'));

/** Separate client used only to create logins for other people: never stores or changes the current session. */
export const createAccountClient = () =>
  createClient(url || 'http://localhost', key || 'missing', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'vc-create-account' }
  });

export const supabase: SupabaseClient = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
