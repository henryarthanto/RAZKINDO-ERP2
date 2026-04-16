import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { createLog } from '@/lib/supabase-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: user } = await db
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang dapat melakukan reset' }, { status: 403 });
    }

    const data = await request.json();
    const { type } = data;

    if (!type || !['all', 'transactions', 'products', 'users'].includes(type)) {
      return NextResponse.json(
        { error: 'Tipe reset tidak valid. Pilih: all, transactions, products, users' },
        { status: 400 }
      );
    }

    // Log this destructive action
    createLog(db, {
      type: 'activity',
      userId,
      action: 'system_reset',
      message: `System reset: ${type}`
    });

    const results: { table: string; deleted: number }[] = [];

    // Delete in correct FK order
    if (type === 'all' || type === 'transactions') {
      const tables = [
        'customer_follow_ups', 'receivable_follow_ups', 'receivables',
        'transaction_items', 'payments', 'transactions'
      ];
      for (const table of tables) {
        const { count } = await db.from(table).delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
        results.push({ table, deleted: count || 0 });
      }
      // Reset customer stats
      await db.from('customers').update({ total_orders: 0, total_spent: 0, last_transaction_date: null }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    if (type === 'all' || type === 'products') {
      const { count: upCount } = await db.from('unit_products').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
      const { count: pCount } = await db.from('products').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'unit_products', deleted: upCount || 0 });
      results.push({ table: 'products', deleted: pCount || 0 });
    }

    if (type === 'all' || type === 'users') {
      // Delete all non-super_admin users and related data
      const { data: nonAdminUsers } = await db
        .from('users')
        .select('id')
        .neq('role', 'super_admin');
      const nonAdminIds = (nonAdminUsers || []).map((u: any) => u.id);

      if (nonAdminIds.length > 0) {
        // Map each table to its correct FK column(s) referencing users
        const tableColumns: Record<string, string[]> = {
          'customer_follow_ups': ['created_by_id'],
          'receivable_follow_ups': ['created_by_id'],
          'company_debt_payments': ['created_by_id'],
          'company_debts': ['created_by_id'],
          'fund_transfers': ['created_by_id'],
          'bank_accounts': ['created_by_id'],
          'cash_boxes': ['created_by_id'],
          'salary_payments': ['user_id'],
          'finance_requests': ['request_by_id', 'processed_by_id'],
          'courier_handovers': ['processed_by_id'],
          'courier_cash': ['courier_id'],
          'events': ['user_id'],
          'logs': ['user_id'],
          'sales_targets': ['user_id'],
          'password_resets': ['user_id'],
        };
        for (const [table, columns] of Object.entries(tableColumns)) {
          for (const col of columns) {
            const { count } = await db.from(table).delete({ count: 'exact' }).in(col, nonAdminIds);
            if (count && count > 0) results.push({ table: `${table}(${col})`, deleted: count });
          }
        }
        const { count } = await db.from('users').delete({ count: 'exact' }).in('id', nonAdminIds);
        results.push({ table: 'users', deleted: count || 0 });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Reset ${type} berhasil dilakukan`,
      details: results
    });
  } catch (error) {
    console.error('System reset error:', error);
    return NextResponse.json(
      { error: 'Gagal melakukan reset' },
      { status: 500 }
    );
  }
}
