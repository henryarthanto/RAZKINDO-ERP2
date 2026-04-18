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

    // Image generation requires external API (e.g., OpenAI DALL-E, Stability AI)
    // For now, return a placeholder SVG image with the prompt text
    const svgImage = generatePlaceholderSVG(prompt);

    return NextResponse.json({
      imageUrl: svgImage,
      isPlaceholder: true,
      message: 'AI image generation memerlukan API tambahan (OpenAI/Stability AI). Hubungi admin untuk mengaktifkan.',
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Generate image error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generatePlaceholderSVG(prompt: string): string {
  const shortPrompt = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="#f0f0f0"/>
    <text x="200" y="180" text-anchor="middle" font-family="Arial" font-size="16" fill="#666">🎨 AI Image</text>
    <text x="200" y="210" text-anchor="middle" font-family="Arial" font-size="12" fill="#999">${escapeXml(shortPrompt)}</text>
    <text x="200" y="260" text-anchor="middle" font-family="Arial" font-size="11" fill="#bbb">Requires Image Gen API</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
