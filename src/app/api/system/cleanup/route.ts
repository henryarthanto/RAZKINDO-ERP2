// =====================================================================
// POST /api/system/cleanup - Clean up Supabase data
// =====================================================================
// Deletes old or all data from specified safe-to-delete tables.
// Requires super_admin role.
// Modes:
//   - "old": delete rows older than N days (based on created_at)
//   - "all": delete all rows from the table
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { db } from '@/lib/supabase';

// Tables safe to delete entirely
const SAFE_DELETE_ALL_TABLES = [
  'events',
  'audit_logs',
  'notifications',
  'push_subscriptions',
  'login_logs',
  'password_reset_tokens',
];

// Tables where old data can be cleaned
const SAFE_CLEAN_OLD_TABLES = [
  'events',
  'audit_logs',
  'notifications',
  'login_logs',
  'password_reset_tokens',
  'transactions',
  'transaction_items',
  'customer_follow_ups',
  'receivable_follow_ups',
  'payments',
  'cashback_transactions',
  'expense_items',
  'sales_tasks',
  'sales_task_history',
];

export async function POST(request: NextRequest) {
  try {
    // Verify super_admin role
    const auth = await enforceSuperAdmin(request);
    if (!auth.success) {
      return auth.response;
    }
    const userId = auth.userId;

    const body = await request.json();
    const { table, mode, olderThanDays = 90 } = body;

    if (!table) {
      return NextResponse.json({ error: 'Nama tabel wajib diisi' }, { status: 400 });
    }

    if (mode === 'all') {
      // Full table delete - only for safe-to-delete tables
      if (!SAFE_DELETE_ALL_TABLES.includes(table)) {
        return NextResponse.json({
          success: false,
          message: `Tabel "${table}" tidak aman untuk dihapus sepenuhnya. Hanya tabel log/events yang dapat dihapus.`,
        });
      }

      // Get count before deletion
      const { count: beforeCount } = await db
        .from(table)
        .select('*', { count: 'exact', head: true });

      // Delete all rows
      const { error } = await db.from(table).delete().neq('id', '00000000-never-match'); // Delete all rows

      if (error) {
        console.error(`[System/Cleanup] Delete all from ${table} error:`, error.message);
        return NextResponse.json({
          success: false,
          message: `Gagal menghapus data dari ${table}: ${error.message}`,
        });
      }

      console.log(`[System/Cleanup] Deleted all ${beforeCount || 0} rows from ${table} by ${userId}`);

      return NextResponse.json({
        success: true,
        message: `Berhasil menghapus ${beforeCount || 0} baris dari tabel ${table}`,
        deletedRows: beforeCount || 0,
        remainingRows: 0,
      });

    } else if (mode === 'old') {
      // Delete old data by date
      if (!SAFE_CLEAN_OLD_TABLES.includes(table)) {
        return NextResponse.json({
          success: false,
          message: `Tabel "${table}" tidak dalam daftar tabel yang boleh dibersihkan.`,
        });
      }

      const days = Math.max(7, Math.min(365, parseInt(olderThanDays) || 90));
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffISO = cutoffDate.toISOString();

      // Get count of rows that will be deleted
      const { count: deleteCount } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .lt('created_at', cutoffISO);

      if (!deleteCount || deleteCount === 0) {
        return NextResponse.json({
          success: true,
          message: `Tidak ada data lebih lama dari ${days} hari di tabel ${table}`,
          deletedRows: 0,
          remainingRows: 0,
        });
      }

      // Delete old rows
      const { error } = await db
        .from(table)
        .delete()
        .lt('created_at', cutoffISO);

      if (error) {
        console.error(`[System/Cleanup] Delete old from ${table} error:`, error.message);
        return NextResponse.json({
          success: false,
          message: `Gagal membersihkan data dari ${table}: ${error.message}`,
        });
      }

      // Get remaining count
      const { count: remainingCount } = await db
        .from(table)
        .select('*', { count: 'exact', head: true });

      console.log(`[System/Cleanup] Deleted ${deleteCount} old rows (${days}d+) from ${table} by ${userId}`);

      return NextResponse.json({
        success: true,
        message: `Berhasil menghapus ${deleteCount} baris lama dari tabel ${table} (lebih dari ${days} hari)`,
        deletedRows: deleteCount,
        remainingRows: remainingCount || 0,
      });

    } else {
      return NextResponse.json({ error: 'Mode tidak valid. Gunakan "old" atau "all".' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[System/Cleanup] Error:', err);
    return NextResponse.json({ error: err.message || 'Gagal membersihkan data' }, { status: 500 });
  }
}
