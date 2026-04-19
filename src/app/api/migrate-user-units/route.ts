import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

// =====================================================================
// AUTO-MIGRATE: Create user_units junction table if it doesn't exist
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    // Check if user_units table already exists
    const { error: checkError } = await db
      .from('user_units')
      .select('id')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({ success: true, message: 'user_units table already exists' });
    }

    return NextResponse.json({
      success: false,
      error: 'Table does not exist. Please run the migration SQL from migrations/add-user-units.sql in Supabase Dashboard SQL Editor.',
    }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Check status
export async function GET() {
  try {
    const { error } = await db
      .from('user_units')
      .select('id')
      .limit(1);

    return NextResponse.json({ exists: !error });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
