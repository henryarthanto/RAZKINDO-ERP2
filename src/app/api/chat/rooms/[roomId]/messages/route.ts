import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { prisma } from '@/lib/supabase';
import { wsEmit } from '@/lib/ws-dispatch';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { roomId } = await params;

    // Mark unread messages as read
    await prisma.chatMessage.updateMany({
      where: { roomId, isRead: false, senderId: { not: userId } },
      data: { isRead: true },
    });

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (room) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      const isSales = user?.role === 'super_admin' || user?.role === 'sales';
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: isSales ? { salesUnread: 0 } : { customerUnread: 0 },
      });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { roomId } = await params;

    const { content, messageType } = await request.json();
    if (!content?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const senderType = (user.role === 'super_admin' || user.role === 'sales') ? 'sales' : 'customer';

    const message = await prisma.chatMessage.create({
      data: {
        roomId,
        senderType,
        senderId: userId,
        senderName: user.name,
        content: content.trim(),
        messageType: messageType || 'text',
      },
    });

    // Update room lastMessage + unread
    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (room) {
      const inc = senderType === 'sales' ? { customerUnread: { increment: 1 } } : { salesUnread: { increment: 1 } };
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { lastMessage: content.trim().slice(0, 100), lastMessageAt: new Date(), ...inc },
      });
    }

    wsEmit({
      event: 'erp:chat_message',
      data: { roomId, message, senderType, senderName: user.name },
      target: 'all',
    });

    return NextResponse.json({ message });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
