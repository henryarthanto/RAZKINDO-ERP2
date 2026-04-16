import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { key } = await params;
    const { value } = await request.json();

    const { data: setting } = await db
      .from('settings')
      .upsert(
        { key, value: JSON.stringify(value) },
        { onConflict: 'key' }
      )
      .select()
      .single();

    return NextResponse.json({ setting: toCamelCase(setting) });
  } catch (error) {
    console.error('Update setting error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
