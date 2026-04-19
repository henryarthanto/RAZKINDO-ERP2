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

    const enhancedPrompt = `Professional product photography of ${prompt.trim()}, clean white background, studio lighting, high quality, detailed, e-commerce style`;

    // Return placeholder SVG
    const svgImage = generatePlaceholderSVG(enhancedPrompt);

    return NextResponse.json({
      imageUrl: svgImage,
      isPlaceholder: true,
      message: 'AI image generation memerlukan API tambahan (OpenAI/Stability AI). Hubungi admin untuk mengaktifkan.',
    });
  } catch (error: any) {
    console.error('Generate image error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal generate gambar' },
      { status: 500 }
    );
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
