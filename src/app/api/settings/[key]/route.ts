import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, generateId } from '@/lib/supabase-helpers';
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

    // Check if the setting already exists
    const { data: existing } = await db
      .from('settings')
      .select('key')
      .eq('key', key)
      .maybeSingle();

    const now = new Date().toISOString();

    let result;
    if (existing) {
      // Update existing setting
      const { data, error } = await db
        .from('settings')
        .update({
          value: JSON.stringify(value),
          updated_at: now,
        })
        .eq('key', key)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      // Insert new setting — MUST provide id since Supabase REST doesn't auto-generate
      const { data, error } = await db
        .from('settings')
        .insert({
          id: generateId(),
          key,
          value: JSON.stringify(value),
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ setting: toCamelCase(result) });
  } catch (error) {
    console.error('Update setting error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
