import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import bcrypt from 'bcryptjs';
import { validateBody } from '@/lib/validators';
import { z } from 'zod';

// Zod schema for phone+code-based reset password (route uses phone/code, not token)
const resetPasswordSchema = z.object({
  phone: z.string().min(1, 'Nomor telepon diperlukan'),
  code: z.string().min(1, 'Kode pemulihan diperlukan'),
  newPassword: z.string().min(6, 'Password minimal 6 karakter'),
});

// POST /api/auth/reset-password
// Verifies recovery code and resets password (phone-based)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = validateBody(resetPasswordSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { phone, code, newPassword } = validation.data;

    // Normalize phone
    const cleanPhone = phone.replace(/\D/g, '');
    const normalizedPhone = cleanPhone.startsWith('0')
      ? '62' + cleanPhone.slice(1)
      : cleanPhone;

    // Find valid, unused recovery code
    const { data: reset } = await db
      .from('password_resets')
      .select('*')
      .eq('identifier', normalizedPhone)
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!reset) {
      return NextResponse.json(
        { error: 'Kode pemulihan tidak valid atau sudah expired' },
        { status: 400 }
      );
    }

    const resetCamel = toCamelCase(reset);

    // Find user by phone
    const { data: user } = await db
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!user) {
      return NextResponse.json(
        { error: 'User tidak ditemukan' },
        { status: 404 }
      );
    }

    const userCamel = toCamelCase(user);

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Sequential operations (no transactions in Supabase JS)
    // 1. Update password
    await db
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userCamel.id);

    // 2. Mark code as used
    await db
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('id', resetCamel.id);

    // 3. Invalidate all other codes for this phone
    await db
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('identifier', normalizedPhone)
      .is('used_at', null)
      .neq('id', resetCamel.id);

    // 4. Create log
    createLog(db, {
      type: 'activity',
      userId: userCamel.id,
      action: 'password_reset',
      message: `Password reset via WhatsApp recovery code`
    });

    // Invalidate auth cache for this user
    const { invalidateUserAuthCache } = await import('@/lib/token');
    invalidateUserAuthCache(userCamel.id);

    return NextResponse.json({
      message: 'Password berhasil diubah! Silakan login dengan password baru.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
