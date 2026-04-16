import { NextResponse } from 'next/server';
import { concurrencyManager } from '@/lib/concurrency-queue';

export async function GET() {
  const health = concurrencyManager.getHealth();
  const stats = concurrencyManager.getStats();
  return NextResponse.json({ health, stats });
}
