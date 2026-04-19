import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { prisma } from '@/lib/supabase';

// GET /api/chat/rooms — list chat rooms
export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const isSuperAdmin = user.role === 'super_admin';

    const rooms = await prisma.chatRoom.findMany({
      where: isSuperAdmin ? undefined : { salesId: userId },
      include: {
        customer: { select: { id: true, name: true, phone: true, code: true } },
        sales: { select: { id: true, name: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({ rooms });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/chat/rooms — create or get chat room
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { customerId } = await request.json();
    if (!customerId) return NextResponse.json({ error: 'Customer ID required' }, { status: 400 });

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, assignedToId: true, unitId: true, name: true },
    });
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const salesId = customer.assignedToId || userId;

    let room = await prisma.chatRoom.findUnique({
      where: { customerId },
      include: {
        customer: { select: { id: true, name: true, phone: true, code: true } },
        sales: { select: { id: true, name: true } },
      },
    });

    if (!room) {
      room = await prisma.chatRoom.create({
        data: { customerId, salesId, unitId: customer.unitId },
        include: {
          customer: { select: { id: true, name: true, phone: true, code: true } },
          sales: { select: { id: true, name: true } },
        },
      });
    }

    return NextResponse.json({ room });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
