import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';

const DEFAULT_PROMPT =
  'professional product photography, white background, studio lighting, high quality, commercial';

export async function POST(request: NextRequest) {
  try {
    // --- Auth check ---
    const authUserId = await verifyAuthUser(
      request.headers.get('authorization')
    );
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Parse body ---
    const body = await request.json();
    const prompt: string = body.prompt?.trim() || DEFAULT_PROMPT;

    // --- Generate image via z-ai-web-dev-sdk (server-side only) ---
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const response = await zai.images.generations.create({
      prompt,
      size: '1024x1024',
    });

    const imageBase64 = response.data[0]?.base64;
    if (!imageBase64) {
      return NextResponse.json(
        { error: 'Failed to generate image' },
        { status: 500 }
      );
    }

    const imageUrl = `data:image/png;base64,${imageBase64}`;

    return NextResponse.json({ imageUrl });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Generate image error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
