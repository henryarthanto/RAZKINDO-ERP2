import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { readFileSync } from 'fs';

// ---- Server-side cache (5 second TTL) ----
let cachedStats: { data: Record<string, unknown>; timestamp: number } | null = null;
const STATS_CACHE_TTL = 5000; // 5 seconds — multiple clients share same snapshot

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Return cached stats if fresh enough
    if (cachedStats && Date.now() - cachedStats.timestamp < STATS_CACHE_TTL) {
      return NextResponse.json({ success: true, data: cachedStats.data });
    }

    // --- CPU Load ---
    let cpuPercent = 0;
    let cpuCores = 1;
    let loadAvg: number[] = [0, 0, 0];
    try {
      const readCpu = (): number[] => {
        const stat = readFileSync('/proc/stat', 'utf-8');
        const line = stat.split('\n')[0];
        const parts = line.split(/\s+/).slice(1).map(Number);
        return parts;
      };
      const c1 = readCpu();
      await new Promise(r => setTimeout(r, 200));
      const c2 = readCpu();
      const d1 = c1.reduce((a, b) => a + b, 0);
      const d2 = c2.reduce((a, b) => a + b, 0);
      const idleDiff = (c2[3] + (c2[4] || 0)) - (c1[3] + (c1[4] || 0));
      const totalDiff = d2 - d1;
      cpuPercent = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;

      // CPU cores & load average — lightweight reads
      cpuCores = readFileSync('/proc/cpuinfo', 'utf-8').split('\n').filter(l => l.startsWith('processor')).length || 1;
      loadAvg = readFileSync('/proc/loadavg', 'utf-8').trim().split(/\s+/).slice(0, 3).map(Number);
    } catch { /* fallback to 0 */ }

    // --- Memory ---
    let memTotal = 0; let memUsed = 0; let memAvailable = 0; let memPercent = 0;
    let swapTotal = 0; let swapUsed = 0;
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf-8');
      const parseMemField = (field: string): number => {
        const match = meminfo.match(new RegExp(`${field}:\\s+(\\d+)`));
        return match ? parseInt(match[1]) : 0;
      };
      memTotal = parseMemField('MemTotal');
      memAvailable = parseMemField('MemAvailable');
      memUsed = memTotal - memAvailable;
      memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
      swapTotal = parseMemField('SwapTotal');
      swapUsed = swapTotal - parseMemField('SwapFree');
    } catch { /* fallback */ }

    // --- Node.js Process Memory ---
    const nodeMem = process.memoryUsage();

    // --- Uptime ---
    const uptimeSeconds = Math.floor(process.uptime());

    // --- Process Info ---
    let processInfo = { pid: process.pid, ppid: 0, threads: 1 };
    try {
      const statContent = readFileSync(`/proc/${process.pid}/stat`, 'utf-8');
      const parts = statContent.split(/\s+/);
      processInfo.ppid = parseInt(parts[3]) || 0;
      processInfo.threads = parseInt(parts[19]) || 1;
    } catch { /* fallback */ }

    // --- Active connections (lightweight — use Node handles instead of execSync) ---
    const activeConnections = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length || 0;

    const data = {
      cpu: { percent: cpuPercent, cores: cpuCores, loadAvg },
      memory: { total: memTotal, used: memUsed, available: memAvailable, percent: memPercent, swapTotal, swapUsed },
      nodeMemory: {
        rss: Math.round(nodeMem.rss / 1024),
        heapTotal: Math.round(nodeMem.heapTotal / 1024),
        heapUsed: Math.round(nodeMem.heapUsed / 1024),
        external: Math.round(nodeMem.external / 1024),
        arrayBuffers: Math.round(nodeMem.arrayBuffers / 1024),
      },
      uptime: uptimeSeconds,
      process: processInfo,
      activeConnections,
      timestamp: new Date().toISOString(),
    };

    // Cache the result
    cachedStats = { data, timestamp: Date.now() };

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('System stats error:', message);
    return NextResponse.json({ success: false, error: 'Gagal mengambil stats sistem' }, { status: 500 });
  }
}
