import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Customer Cashback Withdrawal Request — Public (no auth)
// POST /api/pwa/[code]/cashback/withdraw — Request cashback withdrawal
// =====================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // Validate required fields
    if (typeof data.amount !== 'number' || data.amount <= 0) {
      return NextResponse.json({ error: 'Jumlah pencairan harus lebih dari 0' }, { status: 400 });
    }
    if (!data.bankName || !data.accountNo || !data.accountHolder) {
      return NextResponse.json({ error: 'Data bank wajib diisi (nama bank, nomor rekening, nama pemilik)' }, { status: 400 });
    }
    if (data.amount < 10000) {
      return NextResponse.json({ error: 'Minimum pencairan Rp10.000' }, { status: 400 });
    }

    // Look up customer (only active)
    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, cashback_balance')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Check for recent pending/approved withdrawals from same customer
    const { data: recentWithdrawals } = await db
      .from('cashback_withdrawal')
      .select('id')
      .eq('customer_id', customer.id)
      .in('status', ['pending', 'approved'])
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // last 5 minutes
      .limit(1);

    if (recentWithdrawals && recentWithdrawals.length > 0) {
      return NextResponse.json({ error: 'Anda sudah memiliki pencairan yang sedang diproses. Harap tunggu.' }, { status: 429 });
    }

    const balance = customer.cashback_balance || 0;

    if (data.amount > balance) {
      return NextResponse.json({ error: `Saldo cashback tidak mencukupi. Saldo: Rp${balance.toLocaleString('id-ID')}` }, { status: 400 });
    }

    // Create withdrawal
    const withdrawalId = generateId();
    const balanceAfter = balance - data.amount;

    // Deduct from customer balance using atomic RPC (prevents race condition)
    try {
      const { error: rpcError } = await db.rpc('atomic_deduct_cashback', {
        p_customer_id: customer.id,
        p_amount: data.amount,
      });
      if (rpcError) {
        // RPC may not exist — fallback to read-then-write
        await db
          .from('customers')
          .update({ cashback_balance: balanceAfter })
          .eq('id', customer.id)
          .gt('cashback_balance', data.amount - 1); // optimistic guard
      }
    } catch {
      await db
        .from('customers')
        .update({ cashback_balance: balanceAfter })
        .eq('id', customer.id)
        .gt('cashback_balance', data.amount - 1);
    }

    // Create withdrawal record
    const { data: withdrawal, error: wdError } = await db
      .from('cashback_withdrawal')
      .insert({
        id: withdrawalId,
        customer_id: customer.id,
        amount: data.amount,
        bank_name: data.bankName,
        account_no: data.accountNo,
        account_holder: data.accountHolder,
        status: 'pending',
        notes: data.notes || null,
      })
      .select()
      .single();

    if (wdError) {
      // Rollback: restore customer balance
      await db
        .from('customers')
        .update({ cashback_balance: balance })
        .eq('id', customer.id);
      throw wdError;
    }

    // Create cashback log
    await db.from('cashback_log').insert({
      id: generateId(),
      customer_id: customer.id,
      withdrawal_id: withdrawalId,
      type: 'withdrawn',
      amount: data.amount,
      balance_before: balance,
      balance_after: balanceAfter,
      description: `Pencairan cashback - ${data.bankName} (${data.accountNo})`,
    });

    // Create event notification for super admin
    createEvent(db, 'cashback_withdrawal_requested', {
      withdrawalId,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      amount: data.amount,
      bankName: data.bankName,
      accountNo: data.accountNo,
      accountHolder: data.accountHolder,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      withdrawal: toCamelCase(withdrawal),
      newBalance: balanceAfter,
      message: 'Permintaan pencairan berhasil dikirim. Admin akan memproses dalam 1-3 hari kerja.',
    });
  } catch (error) {
    console.error('PWA cashback withdraw POST error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
