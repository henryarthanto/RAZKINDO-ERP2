// =====================================================================
// GET /api/push/status - Check push notification status for current user
// =====================================================================
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';
import { isPushConfigured } from '@/lib/push-notification';

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if push is configured on server
    const configured = isPushConfigured();

    // Check user's subscription count
    const { count, error } = await db
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.error('[Push/Status] Error:', error.message);
      // Still return configured status even if DB query fails
      return NextResponse.json({
        configured,
        subscribed: false,
        subscriptionCount: 0,
      });
    }

    // Check browser permission state (sent from client)
    const permission = request.headers.get('x-notification-permission') || 'unknown';

    return NextResponse.json({
      configured,
      subscribed: (count || 0) > 0,
      subscriptionCount: count || 0,
      permission,
      vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null,
    });
  } catch (err) {
    console.error('[Push/Status] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
  }
}
