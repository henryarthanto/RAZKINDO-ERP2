// =====================================================================
// GET /api/ai/status - Check Ollama connection & list available models
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { isAvailable, listModels } from '@/lib/ai';

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configured = isAvailable();

    if (!configured) {
      return NextResponse.json({
        configured: false,
        connected: false,
        models: [],
        defaultModel: null,
        message: 'Ollama belum dikonfigurasi. Tambahkan OLLAMA_HOST di .env',
      });
    }

    // Try to connect and list models
    let models: string[] = [];
    let connected = false;
    let errorMessage: string | null = null;

    try {
      models = await listModels();
      connected = true;
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('ECONNREFUSED') || msg.includes('connection refused')) {
        errorMessage = `Ollama tidak bisa dijangkau di ${process.env.OLLAMA_HOST || 'http://localhost:11434'}. Pastikan Ollama berjalan.`;
      } else {
        errorMessage = `Error koneksi Ollama: ${msg.substring(0, 200)}`;
      }
    }

    // Check if default model is available
    const defaultModel = process.env.OLLAMA_MODEL || 'llama3:8b';
    const hasDefaultModel = models.some(m => m === defaultModel || m.startsWith(defaultModel.split(':')[0]));

    return NextResponse.json({
      configured: true,
      connected,
      models,
      defaultModel,
      hasDefaultModel,
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      errorMessage,
    });
  } catch (err: any) {
    console.error('[AI/Status] Error:', err);
    return NextResponse.json({ error: err.message || 'Gagal cek status AI' }, { status: 500 });
  }
}
