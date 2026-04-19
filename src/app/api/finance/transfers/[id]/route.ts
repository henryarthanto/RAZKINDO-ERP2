import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, createLog } from '@/lib/supabase-helpers';
import { atomicUpdateBalance } from '@/lib/atomic-ops';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat memproses transfer' }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const VALID_STATUSES = ['pending', 'completed', 'cancelled'];
    if (data.status !== undefined && !VALID_STATUSES.includes(data.status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
    }

    if (data.status === 'completed') {
      const { data: freshTransfer, error: fetchError } = await db.from('fund_transfers').select(`
        *,
        from_bank_account:bank_accounts!from_bank_account_id(id, balance),
        to_bank_account:bank_accounts!to_bank_account_id(id, balance),
        from_cash_box:cash_boxes!from_cash_box_id(id, balance),
        to_cash_box:cash_boxes!to_cash_box_id(id, balance)
      `).eq('id', id).single();

      if (fetchError || !freshTransfer) {
        return NextResponse.json({ error: 'Transfer tidak ditemukan' }, { status: 404 });
      }
      if (freshTransfer.status !== 'pending') {
        return NextResponse.json({ error: 'Transfer sudah diproses' }, { status: 400 });
      }

      const amount = freshTransfer.amount;

      // Atomically deduct from source (throws if insufficient)
      try {
        if (freshTransfer.from_bank_account_id) {
          await atomicUpdateBalance('bank_accounts', freshTransfer.from_bank_account_id, -amount);
        }
        if (freshTransfer.from_cash_box_id) {
          await atomicUpdateBalance('cash_boxes', freshTransfer.from_cash_box_id, -amount);
        }
      } catch {
        return NextResponse.json({ error: 'Saldo sumber tidak cukup' }, { status: 400 });
      }

      // Atomically add to destination
      if (freshTransfer.to_bank_account_id) {
        await atomicUpdateBalance('bank_accounts', freshTransfer.to_bank_account_id, amount);
      }
      if (freshTransfer.to_cash_box_id) {
        await atomicUpdateBalance('cash_boxes', freshTransfer.to_cash_box_id, amount);
      }

      // Optimistic lock update
      const { data: updated, error: updateError } = await db.from('fund_transfers').update({
        status: 'completed', processed_by_id: authUserId, processed_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'pending').select(`
        *, from_bank_account:bank_accounts!from_bank_account_id(id, name, bank_name, account_no, balance),
        to_bank_account:bank_accounts!to_bank_account_id(id, name, bank_name, account_no, balance),
        from_cash_box:cash_boxes!from_cash_box_id(id, name, balance), to_cash_box:cash_boxes!to_cash_box_id(id, name, balance)
      `).single();

      if (updateError || !updated) {
        // Rollback balance changes since optimistic lock failed
        if (freshTransfer.from_bank_account_id) {
          try { await atomicUpdateBalance('bank_accounts', freshTransfer.from_bank_account_id, amount); } catch { /* best effort rollback */ }
        }
        if (freshTransfer.from_cash_box_id) {
          try { await atomicUpdateBalance('cash_boxes', freshTransfer.from_cash_box_id, amount); } catch { /* best effort rollback */ }
        }
        if (freshTransfer.to_bank_account_id) {
          try { await atomicUpdateBalance('bank_accounts', freshTransfer.to_bank_account_id, -amount, -999999999999999); } catch { /* best effort rollback */ }
        }
        if (freshTransfer.to_cash_box_id) {
          try { await atomicUpdateBalance('cash_boxes', freshTransfer.to_cash_box_id, -amount, -999999999999999); } catch { /* best effort rollback */ }
        }
        return NextResponse.json({ error: 'Transfer sudah diproses atau terjadi konflik' }, { status: 409 });
      }

      createLog(db, { type: 'activity', userId: authUserId, action: 'fund_transfer_completed', entity: 'fund_transfer', entityId: id, message: `Transfer dana Rp ${amount.toLocaleString('id-ID')} berhasil diproses` });

      wsFinanceUpdate({ type: 'transfer_completed', transferId: id });

      return NextResponse.json({ transfer: toCamelCase(updated) });
    }

    // Cancellation
    const { data: freshTransfer, error: fetchError } = await db.from('fund_transfers').select('*').eq('id', id).single();
    if (fetchError || !freshTransfer) {
      return NextResponse.json({ error: 'Transfer tidak ditemukan' }, { status: 404 });
    }
    if (freshTransfer.status !== 'pending') {
      return NextResponse.json({ error: 'Transfer sudah diproses' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await db.from('fund_transfers').update({
      status: data.status, processed_by_id: authUserId,
    }).eq('id', id).eq('status', 'pending').select().single();

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Transfer sudah diproses' }, { status: 400 });
    }

    createLog(db, { type: 'activity', userId: authUserId, action: `fund_transfer_${data.status}`, entity: 'fund_transfer', entityId: id, message: `Transfer dana ${data.status}` });

    return NextResponse.json({ transfer: toCamelCase(updated) });
  } catch (error) {
    console.error('Update fund transfer error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
