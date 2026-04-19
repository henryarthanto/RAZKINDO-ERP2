import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { prisma } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { roomId } = await params;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isSales = user?.role === 'super_admin' || user?.role === 'sales';

    await prisma.chatMessage.updateMany({
      where: { roomId, isRead: false, senderType: isSales ? 'customer' : 'sales' },
      data: { isRead: true },
    });

    await prisma.chatRoom.update({
      where: { id: roomId },
      data: isSales ? { salesUnread: 0 } : { customerUnread: 0 },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
