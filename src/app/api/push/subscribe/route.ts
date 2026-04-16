// =====================================================================
// POST /api/push/subscribe - Register a push subscription
// =====================================================================
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { endpoint, keys, deviceInfo } = body;

    // Validate required fields
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: 'Data subscription tidak lengkap' },
        { status: 400 }
      );
    }

    // Upsert: delete any existing subscription for this user + endpoint,
    // then insert new one (handles subscription renewal)
    await db.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);

    const { error } = await db.from('push_subscriptions').insert({
      user_id: userId,
      endpoint,
      keys_p256dh: keys.p256dh,
      keys_auth: keys.auth,
      device_info: deviceInfo ? JSON.stringify(deviceInfo) : null,
    });

    if (error) {
      // Handle unique constraint on endpoint (another user has same endpoint)
      if (error.code === '23505') {
        // Delete the old subscription and retry
        await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
        const retry = await db.from('push_subscriptions').insert({
          user_id: userId,
          endpoint,
          keys_p256dh: keys.p256dh,
          keys_auth: keys.auth,
          device_info: deviceInfo ? JSON.stringify(deviceInfo) : null,
        });
        if (retry.error) {
          console.error('[Push/Subscribe] Retry failed:', retry.error.message);
          return NextResponse.json({ error: 'Gagal menyimpan subscription' }, { status: 500 });
        }
      } else {
        console.error('[Push/Subscribe] Insert error:', error.message);
        return NextResponse.json({ error: 'Gagal menyimpan subscription' }, { status: 500 });
      }
    }

    console.log(`[Push/Subscribe] User ${userId} subscribed to push notifications`);
    return NextResponse.json({ success: true, message: 'Notifikasi aktif' });
  } catch (err) {
    console.error('[Push/Subscribe] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
  }
}
