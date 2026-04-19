import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';

// POST /api/finance/bank-accounts/[id]/deposit
// Tambah dana ke rekening bank → otomatis masuk ke Dana Lain-lain di pool
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

    // Fetch current bank (for name/log only)
    const { data: bank, error: fetchError } = await db
      .from('bank_accounts')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !bank) {
      return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
    }

    if (!bank.is_active) {
      return NextResponse.json({ error: 'Rekening sudah tidak aktif' }, { status: 400 });
    }

    const currentBalance = Number(bank.balance) || 0;

    // Atomically update bank balance
    const newBalance = await atomicUpdateBalance('bank_accounts', id, roundedAmount);

    // Atomically add to Dana Lain-lain (pool_investor_fund) in settings
    const newInvestorFund = await atomicUpdatePoolBalance('pool_investor_fund', roundedAmount);

    // Log
    try {
      createLog(db, {
        type: 'audit',
        action: 'bank_deposit',
        entity: 'bank_accounts',
        entityId: id,
        userId,
        message: `Dana ditambahkan ke ${bank.name} (${bank.bank_name}): Rp ${roundedAmount.toLocaleString('id-ID')}. Saldo: ${currentBalance.toLocaleString('id-ID')} → ${newBalance.toLocaleString('id-ID')}. Dana Lain-lain: ${(newInvestorFund - roundedAmount).toLocaleString('id-ID')} → ${newInvestorFund.toLocaleString('id-ID')}${description ? `. Keterangan: ${description}` : ''}`
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      bankAccount: toCamelCase({ ...bank, balance: newBalance }),
      investorFund: newInvestorFund,
      message: `Dana berhasil ditambahkan ke ${bank.name}. Saldo baru: Rp ${newBalance.toLocaleString('id-ID')}`
    });
  } catch (error) {
    console.error('Bank deposit error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
