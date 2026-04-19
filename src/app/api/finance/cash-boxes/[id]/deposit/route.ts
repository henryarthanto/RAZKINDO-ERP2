import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';

// POST /api/finance/cash-boxes/[id]/deposit
// Tambah dana ke brankas → otomatis masuk ke Dana Lain-lain di pool
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const userId = authResult.userId;

    const { id } = await params;
    const { amount, description } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Jumlah harus lebih dari 0' }, { status: 400 });
    }

    const roundedAmount = Math.round(Number(amount));

    // Fetch current cash box (for name/log only)
    const { data: cashBox, error: fetchError } = await db
      .from('cash_boxes')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !cashBox) {
      return NextResponse.json({ error: 'Brankas tidak ditemukan' }, { status: 404 });
    }

    if (!cashBox.is_active) {
      return NextResponse.json({ error: 'Brankas sudah tidak aktif' }, { status: 400 });
    }

    const currentBalance = Number(cashBox.balance) || 0;

    // Atomically update cash box balance
    const newBalance = await atomicUpdateBalance('cash_boxes', id, roundedAmount);

    // Atomically add to Dana Lain-lain (pool_investor_fund) in settings
    const newInvestorFund = await atomicUpdatePoolBalance('pool_investor_fund', roundedAmount);

    // Log
    try {
      createLog(db, {
        type: 'audit',
        action: 'cashbox_deposit',
        entity: 'cash_boxes',
        entityId: id,
        userId,
        message: `Dana ditambahkan ke brankas ${cashBox.name}: Rp ${roundedAmount.toLocaleString('id-ID')}. Saldo: ${currentBalance.toLocaleString('id-ID')} → ${newBalance.toLocaleString('id-ID')}. Dana Lain-lain: ${(newInvestorFund - roundedAmount).toLocaleString('id-ID')} → ${newInvestorFund.toLocaleString('id-ID')}${description ? `. Keterangan: ${description}` : ''}`
      });
    } catch { /* ignore */ }

    // Notify other clients about pool update
    wsFinanceUpdate({ cashBoxId: id, amount: roundedAmount, action: 'deposit' }).catch(() => {});

    return NextResponse.json({
      cashBox: toCamelCase({ ...cashBox, balance: newBalance }),
      investorFund: newInvestorFund,
      message: `Dana berhasil ditambahkan ke ${cashBox.name}. Saldo baru: Rp ${newBalance.toLocaleString('id-ID')}`
    });
  } catch (error) {
    console.error('Cash box deposit error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
