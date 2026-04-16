import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

/**
 * GET /api/whatsapp/config
 * Get current WhatsApp config from database settings
 * Token is returned masked for security (first 8 chars + ****)
 */
export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { data: setting, error } = await db.from('settings').select('*').eq('key', 'whatsapp_config').maybeSingle();
    if (error) throw error;

    if (!setting) {
      return NextResponse.json({
        config: {
          token: '',
          tokenMasked: false,
          enabled: false,
          target_type: 'group',
          target_id: '',
          message_template: ''
        }
      });
    }

    let config: any;
    try {
      config = JSON.parse(setting.value);
    } catch {
      return NextResponse.json({
        config: {
          token: '',
          tokenMasked: false,
          enabled: false,
          target_type: 'group',
          target_id: '',
          message_template: ''
        }
      });
    }

    // Mask token in response to prevent API key exposure
    const maskedConfig = {
      ...config,
      token: config.token ? config.token.slice(0, 8) + '****' : '',
      tokenMasked: !!config.token,
      tokenInvalid: config._tokenInvalid || false,
      tokenInvalidAt: config._tokenInvalidAt || null
    };

    return NextResponse.json({ config: maskedConfig });
  } catch (error) {
    console.error('Get WhatsApp config error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/whatsapp/config
 * Save WhatsApp config to database
 * If token ends with ****, preserve the existing token (user didn't change it)
 */
export async function PATCH(request: NextRequest) {
  try {
    // Auth check
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const body = await request.json();
    const { token, enabled, target_type, target_id, message_template } = body;

    // Check if token is masked (user didn't change it) — preserve existing token
    let finalToken = token?.trim() || '';

    if (finalToken && finalToken.endsWith('****')) {
      // User didn't change the token — keep the existing one from DB
      const { data: existing } = await db.from('settings').select('value').eq('key', 'whatsapp_config').maybeSingle();

      if (existing) {
        try {
          const existingConfig = JSON.parse(existing.value);
          finalToken = existingConfig.token || '';
        } catch {
          finalToken = '';
        }
      } else {
        finalToken = '';
      }
    }

    // Build config — no strict validation, just save what's provided
    const config = {
      token: finalToken,
      enabled: enabled || false,
      target_type: target_type || 'group',
      target_id: target_id?.trim() || '',
      message_template: message_template || ''
    };

    // Clear token invalid flags when user saves new token or config
    // (user is actively managing the setting, so clear any auto-disable flags)
    const configToStore = {
      ...config,
      _tokenInvalid: false,
      _tokenInvalidAt: null
    };

    // Upsert: check if exists, then insert or update
    const { data: existingSetting } = await db.from('settings').select('key').eq('key', 'whatsapp_config').maybeSingle();
    if (existingSetting) {
      const { error } = await db.from('settings').update({ value: JSON.stringify(configToStore) }).eq('key', 'whatsapp_config');
      if (error) throw error;
    } else {
      const { error } = await db.from('settings').insert({ key: 'whatsapp_config', value: JSON.stringify(configToStore) });
      if (error) throw error;
    }

    // Return success with masked token
    const maskedConfig = {
      ...config,
      token: config.token ? config.token.slice(0, 8) + '****' : '',
      tokenMasked: !!config.token
    };

    return NextResponse.json({ config: maskedConfig });
  } catch (error) {
    console.error('Save WhatsApp config error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
