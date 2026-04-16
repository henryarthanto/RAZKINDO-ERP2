import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

/**
 * GET /api/whatsapp/message-template
 * Get current message template from settings
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { data: setting, error } = await db.from('settings').select('*').eq('key', 'whatsapp_message_template').maybeSingle();
    if (error) throw error;

    if (!setting) {
      return NextResponse.json({
        template: ''
      });
    }

    const template = setting.value;

    return NextResponse.json({ template });
  } catch (error) {
    console.error('Get message template error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/whatsapp/message-template
 * Save message template
 * Body: { template: string }
 * 
 * Template uses variables like:
 * {sales_name}, {customer_name}, {unit_name}, {items}, {total}, {paid}, {remaining},
 * {payment_method}, {invoice_no}, {date}, {due_date}, {customer_phone}, {delivery_address}
 */
export async function PATCH(request: NextRequest) {
  try {
    // Auth check
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const body = await request.json();
    const { template } = body;

    if (!template || typeof template !== 'string') {
      return NextResponse.json(
        { error: 'Template pesan tidak boleh kosong' },
        { status: 400 }
      );
    }

    // Upsert: check if exists, then insert or update
    const { data: existingSetting } = await db.from('settings').select('key').eq('key', 'whatsapp_message_template').maybeSingle();
    if (existingSetting) {
      const { error } = await db.from('settings').update({ value: template }).eq('key', 'whatsapp_message_template');
      if (error) throw error;
    } else {
      const { error } = await db.from('settings').insert({ key: 'whatsapp_message_template', value: template });
      if (error) throw error;
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error('Save message template error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
