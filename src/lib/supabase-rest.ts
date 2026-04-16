// =====================================================================
// SUPABASE REST CLIENT — Real @supabase/supabase-js connection
//
// Creates a real Supabase client that connects to the remote Supabase
// PostgreSQL project via HTTPS REST API (no direct DB connection needed).
//
// This is the single source of truth for the Supabase connection config.
// All other modules that need the real Supabase client should import
// from here.
//
// Exports:
//   supabaseRestClient — real Supabase client (from '@supabase/supabase-js')
//   SUPABASE_URL        — resolved project URL
//   SUPABASE_ANON_KEY   — resolved anon key
//   SUPABASE_SERVICE_KEY — resolved service role key
// =====================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────
// CONFIGURATION — BUG FIX #6: Removed hardcoded credentials, fail loudly if env missing
// ─────────────────────────────────────────────────────────────────────

/** Supabase project URL — from env only (no hardcoded fallback) */
export const SUPABASE_URL: string = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required in .env');
  return url;
})();

/** Supabase anon (publishable) key — from env only (no hardcoded fallback) */
export const SUPABASE_ANON_KEY: string = (() => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required in .env');
  return key;
})();

/** Supabase service role key — bypasses all RLS policies, server-side only */
export const SUPABASE_SERVICE_KEY: string = (() => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is required in .env');
  return key;
})();

// ─────────────────────────────────────────────────────────────────────
// CLIENT SINGLETON
// ─────────────────────────────────────────────────────────────────────

const globalForSupabase = globalThis as unknown as {
  supabaseRestClient: SupabaseClient | undefined;
};

/**
 * Real Supabase client connected to the remote project.
 * Uses the singleton pattern to prevent multiple instances in dev mode.
 *
 * This client supports the full Supabase API:
 *   - .from('table').select('*').eq('col', 'val').order('col').limit(10)
 *   - .from('table').insert(data).select()
 *   - .from('table').update(data).eq('id', id).select()
 *   - .from('table').delete().eq('id', id)
 *   - .rpc('function_name', { params })
 *   - .auth.getUser()
 *   - .storage.from('bucket').upload(...)
 */
export const supabaseRestClient: SupabaseClient =
  globalForSupabase.supabaseRestClient ||
  createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    // Use service_role key — bypasses Row Level Security for server-side operations
    auth: {
      persistSession: false, // Server-side — no cookie/session persistence
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
  });

// Persist singleton in development to survive HMR
if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabaseRestClient = supabaseRestClient;
}
