// =====================================================================
// AI TTS (Text-to-Speech) API
// Endpoint: POST /api/ai/tts
//
// NOTE: After migrating from z-ai-web-dev-sdk to Google Gemini,
// server-side TTS is no longer available (Gemini doesn't offer TTS).
// This endpoint now returns the text for the frontend to use
// browser's built-in SpeechSynthesis API instead.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';

export async function POST(request: NextRequest) {
  try {
    // --- Auth check ---
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Parse body ---
    const body = await request.json();
    const { text, voice, speed } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text wajib diisi' }, { status: 400 });
    }

    // Return text with instructions for browser TTS
    // Frontend will use window.speechSynthesis to speak
    return NextResponse.json({
      success: true,
      text: text.trim(),
      voice: voice || 'default',
      speed: typeof speed === 'number' ? Math.max(0.5, Math.min(2.0, speed)) : 1.0,
      useBrowserTTS: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Gagal memproses TTS';
    console.error('TTS error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
