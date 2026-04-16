import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    // Bug #1 FIX: Use verifyAuthUser (any auth'd user) instead of enforceFinanceRole
    // Courier cash summary is read-only and useful for all roles
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // OPTIMIZATION: Use RPC instead of fetching all records and summing in JS
    const { data: totalsData, error: totalsError } = await db.rpc('get_courier_cash_totals');
    if (totalsError) {
      console.error('[COURIER_CASH_SUMMARY] RPC failed, falling back to direct query:', totalsError.message);
      // Fallback
      const { data: allRecords } = await db.from('courier_cash').select('balance, total_collected, total_handover');
      const totalWithCouriers = (allRecords || []).reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
      const totalCollected = (allRecords || []).reduce((sum: number, r: any) => sum + (r.total_collected || 0), 0);
      const totalHandedOver = (allRecords || []).reduce((sum: number, r: any) => sum + (r.total_handover || 0), 0);
      return NextResponse.json({ totalWithCouriers, totalCollected, totalHandedOver });
    }
    return NextResponse.json({
      totalWithCouriers: totalsData?.totalBalance || 0,
      totalCollected: totalsData?.totalCollected || 0,
      totalHandedOver: totalsData?.totalHandover || 0,
    });
  } catch (error) {
    console.error('Courier cash summary error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
