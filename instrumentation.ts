// =====================================================================
// Next.js Instrumentation Hook
//
// Runs once when the Next.js server starts (Node.js runtime only).
// Initializes only essential server-side services.
// Heavy services (PerformanceMonitor, ConcurrencyManager, BatchOptimizer)
// are lazy-initialized on first use instead of eagerly at startup.
// =====================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize memory monitoring (lightweight — just a timer)
    try {
      await import('./src/lib/memory-init');
    } catch (e: any) {
      console.warn('[Instrumentation] MemoryGuard init skipped:', e.message?.substring(0, 80));
    }

    // Consistency scheduler — startup check DISABLED to reduce memory/CPU pressure.
    // Periodic checks still run every 6 hours.
    try {
      const { startConsistencyScheduler } = await import('./src/lib/consistency-scheduler');
      startConsistencyScheduler(6 * 60 * 60 * 1000, false); // Every 6 hours, no startup check
    } catch (e: any) {
      console.warn('[Instrumentation] Consistency scheduler init skipped:', e.message?.substring(0, 80));
    }

    // PerformanceMonitor, ConcurrencyManager, BatchOptimizer are now
    // lazy-initialized via Proxy — no need to eagerly import them here.
    // They will be created on first actual use.

    // Ensure critical RPC functions exist in the database
    try {
      const { ensureRpcFunctions } = await import('./src/lib/ensure-rpc');
      await ensureRpcFunctions();
    } catch (e: any) {
      console.warn('[Instrumentation] RPC setup skipped:', e.message?.substring(0, 80));
    }

    console.log('[Instrumentation] Server-side services initialized (lazy mode).');
  }
}
