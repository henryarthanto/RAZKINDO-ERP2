// =====================================================================
// Next.js Instrumentation Hook
//
// Runs once when the Next.js server starts (Node.js runtime only).
// Initializes server-side services: MemoryGuard, ConsistencyScheduler,
// and PerformanceMonitor.
// =====================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize memory monitoring
    try {
      await import('./src/lib/memory-init');
    } catch (e: any) {
      console.warn('[Instrumentation] MemoryGuard init skipped:', e.message?.substring(0, 80));
    }

    // Initialize periodic consistency checking
    try {
      const { startConsistencyScheduler } = await import('./src/lib/consistency-scheduler');
      startConsistencyScheduler(6 * 60 * 60 * 1000); // Every 6 hours
    } catch (e: any) {
      console.warn('[Instrumentation] Consistency scheduler init skipped:', e.message?.substring(0, 80));
    }

    // Initialize performance monitor (singleton is created on first import)
    try {
      const { perfMonitor } = await import('./src/lib/performance-monitor');
      perfMonitor.setGauge('server.startup', 1);
      console.log('[Instrumentation] PerformanceMonitor initialized.');
    } catch (e: any) {
      console.warn('[Instrumentation] PerformanceMonitor init skipped:', e.message?.substring(0, 80));
    }

    // Ensure critical RPC functions exist in the database
    try {
      const { ensureRpcFunctions } = await import('./src/lib/ensure-rpc');
      await ensureRpcFunctions();
    } catch (e: any) {
      console.warn('[Instrumentation] RPC setup skipped:', e.message?.substring(0, 80));
    }

    console.log('[Instrumentation] Server-side services initialized.');
  }
}
