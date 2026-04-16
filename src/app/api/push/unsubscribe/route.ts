// =====================================================================
// POST /api/push/unsubscribe - Remove a push subscription
// =====================================================================
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint diperlukan' }, { status: 400 });
    }

    // Delete specific subscription (user + endpoint match)
    const { error } = await db
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);

    if (error) {
      console.error('[Push/Unsubscribe] Error:', error.message);
      return NextResponse.json({ error: 'Gagal menghapus subscription' }, { status: 500 });
    }

    console.log(`[Push/Unsubscribe] User ${userId} unsubscribed`);
    return NextResponse.json({ success: true, message: 'Notifikasi dinonaktifkan' });
  } catch (err) {
    console.error('[Push/Unsubscribe] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
  }
}

// DELETE all subscriptions for the current user
export async function DELETE(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await db.from('push_subscriptions').delete().eq('user_id', userId);

    if (error) {
      console.error('[Push/Unsubscribe] Delete all error:', error.message);
      return NextResponse.json({ error: 'Gagal menghapus subscriptions' }, { status: 500 });
    }

    console.log(`[Push/Unsubscribe] All subscriptions removed for user ${userId}`);
    return NextResponse.json({ success: true, message: 'Semua notifikasi dinonaktifkan' });
  } catch (err) {
    console.error('[Push/Unsubscribe] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan' }, { status: 500 });
  }
}
