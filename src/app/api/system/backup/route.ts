import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';

/**
 * GET /api/system/backup
 * Export all data as JSON (Supabase version - no SQLite file access)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const userId = await verifyAuthUser(authHeader);
    if (!userId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { data: user } = await db
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 });
    }

    // Export all table data as JSON
    const tables = [
      'units', 'users', 'password_resets', 'products', 'unit_products',
      'customers', 'customer_follow_ups', 'suppliers', 'transactions',
      'transaction_items', 'payments', 'salary_payments', 'bank_accounts',
      'cash_boxes', 'finance_requests', 'fund_transfers', 'company_debts',
      'company_debt_payments', 'receivables', 'receivable_follow_ups',
      'logs', 'sales_targets', 'sales_tasks', 'sales_task_reports',
      'courier_cash', 'courier_handovers', 'events', 'settings'
    ];

    const backup: Record<string, any[]> = {};

    for (const table of tables) {
      const { data } = await db.from(table).select('*').limit(50000);
      // Remove passwords from users export
      if (table === 'users' && data) {
        backup[table] = data.map((row: any) => {
          const { password, ...rest } = row;
          return rest;
        });
      } else {
        backup[table] = data || [];
      }
    }

    const jsonStr = JSON.stringify(backup, null, 2);
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `razkindo-erp-backup-${dateStr}.json`;

    return new NextResponse(jsonStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(jsonStr).toString(),
      },
    });
  } catch (error) {
    console.error('Backup error:', error);
    return NextResponse.json({ error: 'Gagal membuat backup' }, { status: 500 });
  }
}
