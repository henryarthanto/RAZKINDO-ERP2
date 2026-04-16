import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt } = await request.json();
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return NextResponse.json({ error: 'Prompt minimal 3 karakter' }, { status: 400 });
    }

    // Dynamic import to avoid bundling in client
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const enhancedPrompt = `Professional product photography of ${prompt.trim()}, clean white background, studio lighting, high quality, detailed, e-commerce style`;

    const response = await zai.images.generations.create({
      prompt: enhancedPrompt,
      size: '1024x1024',
    });

    const imageBase64 = response.data[0]?.base64;
    if (!imageBase64) {
      return NextResponse.json({ error: 'Gagal generate gambar' }, { status: 500 });
    }

    // Return as data URL for direct use in img src
    const dataUrl = `data:image/png;base64,${imageBase64}`;

    return NextResponse.json({ imageUrl: dataUrl });
  } catch (error: any) {
    console.error('Generate image error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal generate gambar' },
      { status: 500 }
    );
  }
}
