import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, toSnakeCase, createLog } from '@/lib/supabase-helpers';

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { data: salary, error } = await db.from('salary_payments').select(`
      *, user:users!user_id(id, name, email, role), finance_request:finance_requests(id, type, amount, status)
    `).eq('id', id).single();

    if (error || !salary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ salary: toCamelCase(salary) });
  } catch (error) {
    console.error('Get salary error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PATCH(
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
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat mengubah gaji' }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const { data: salary, error: fetchError } = await db.from('salary_payments').select('*, user:users!user_id(id, name)').eq('id', id).single();
    if (fetchError || !salary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }

    if (salary.status !== 'pending') {
      return NextResponse.json({ error: 'Hanya gaji dengan status pending yang dapat diubah' }, { status: 400 });
    }

    const totalAllowance = (data.transportAllowance ?? salary.transport_allowance) + (data.mealAllowance ?? salary.meal_allowance) + (data.overtimePay ?? salary.overtime_pay) + (data.incentive ?? salary.incentive) + (data.otherAllowance ?? salary.other_allowance) + (data.bonus ?? salary.bonus);
    const totalDeduction = (data.bpjsTk ?? salary.bpjs_tk) + (data.bpjsKs ?? salary.bpjs_ks) + (data.pph21 ?? salary.pph21) + (data.loanDeduction ?? salary.loan_deduction) + (data.absenceDeduction ?? salary.absence_deduction) + (data.lateDeduction ?? salary.late_deduction) + (data.otherDeduction ?? salary.other_deduction) + (data.deduction ?? salary.deduction);
    const totalAmount = Math.max(0, (data.baseSalary ?? salary.base_salary) + totalAllowance - totalDeduction);

    const updateData = toSnakeCase({
      baseSalary: data.baseSalary ?? salary.base_salary,
      transportAllowance: data.transportAllowance ?? salary.transport_allowance,
      mealAllowance: data.mealAllowance ?? salary.meal_allowance,
      overtimePay: data.overtimePay ?? salary.overtime_pay,
      incentive: data.incentive ?? salary.incentive,
      otherAllowance: data.otherAllowance ?? salary.other_allowance,
      bonus: data.bonus ?? salary.bonus,
      bpjsTk: data.bpjsTk ?? salary.bpjs_tk,
      bpjsKs: data.bpjsKs ?? salary.bpjs_ks,
      pph21: data.pph21 ?? salary.pph21,
      loanDeduction: data.loanDeduction ?? salary.loan_deduction,
      absenceDeduction: data.absenceDeduction ?? salary.absence_deduction,
      lateDeduction: data.lateDeduction ?? salary.late_deduction,
      otherDeduction: data.otherDeduction ?? salary.other_deduction,
      deduction: data.deduction ?? salary.deduction,
      totalAllowance, totalDeduction, totalAmount,
      sourceType: data.sourceType ?? salary.source_type,
      bankAccountId: data.bankAccountId ?? salary.bank_account_id,
      notes: data.notes ?? salary.notes,
    });

    const { data: updatedSalary, error } = await db.from('salary_payments').update(updateData).eq('id', id).select(`
      *, user:users!user_id(id, name), finance_request:finance_requests(id, type, amount, status)
    `).single();
    if (error) throw error;

    // Update linked FinanceRequest amount
    if (salary.finance_request_id) {
      const userData = (updatedSalary as any).user;
      const periodDesc = `Periode ${formatDate(updatedSalary.period_start)} s/d ${formatDate(updatedSalary.period_end)}`;
      await db.from('finance_requests').update({
        amount: totalAmount,
        description: `Gaji ${userData?.name || 'Karyawan'} - ${periodDesc}`,
        source_type: data.sourceType ?? salary.source_type,
        bank_account_id: data.bankAccountId ?? salary.bank_account_id,
      }).eq('id', salary.finance_request_id);
    }

    return NextResponse.json({ salary: toCamelCase(updatedSalary) });
  } catch (error) {
    console.error('Update salary error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
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
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat mengubah gaji' }, { status: 403 });
    }

    const { id } = await params;

    const { data: salary, error: fetchError } = await db.from('salary_payments').select('finance_request_id, status').eq('id', id).single();
    if (fetchError || !salary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }

    if (salary.status !== 'pending') {
      return NextResponse.json({ error: 'Hanya gaji dengan status pending yang dapat dihapus' }, { status: 400 });
    }

    if (salary.finance_request_id) {
      await db.from('finance_requests').delete().eq('id', salary.finance_request_id);
    }
    const { error } = await db.from('salary_payments').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete salary error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
