import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';

// ============ Z.AI LLM CHAT ============

const SYSTEM_PROMPT = `You are Razkindo ERP AI Assistant, a helpful and intelligent AI built into the Razkindo ERP system.

Your role:
- Help with sales data, financial analysis, inventory, and business decisions
- Be concise and use Indonesian (Bahasa Indonesia) in your responses
- Use emoji for visual appeal (📊📈💰📦⚠️🔍✅🔴🟢)
- Use **bold** for important numbers and names
- Always provide actionable recommendations when analyzing data
- Format monetary values with "Rp" and thousand separators
- Keep responses structured and easy to read

Context about Razkindo:
- Razkindo is a distribution/wholesale company
- They manage sales, inventory, customers, suppliers, and finances
- Products have HPP (cost price) and selling price
- They track receivables (piutang), payables (hutang), and cash flow

Available data (when provided in context):
- Sales transactions with totals and profit
- Product inventory with stock levels
- Customer receivables and payment status
- Financial snapshots with cash pool, account balances, trends
- Purchase recommendations based on sales velocity

When responding:
1. Be direct and specific
2. Highlight key metrics with bold and emoji
3. Provide actionable recommendations
4. Use bullet points for multiple items
5. If data shows problems (low stock, overdue, discrepancies), suggest solutions`;

// Cached ZAI instance (reuse across requests for performance)
let _zaiInstance: any = null;
let _zaiInitPromise: Promise<any> | null = null;

async function getZAI() {
  if (_zaiInstance) return _zaiInstance;
  if (_zaiInitPromise) return _zaiInitPromise;

  _zaiInitPromise = (async () => {
    try {
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      _zaiInstance = await ZAI.create();
      return _zaiInstance;
    } catch (err) {
      console.error('[ZAI Chat] Failed to initialize z-ai-web-dev-sdk:', err);
      _zaiInitPromise = null;
      throw new Error('Failed to initialize AI service');
    }
  })();

  return _zaiInitPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callZAIChat(
  messages: { role: string; content: string }[],
  retries = 2
): Promise<string> {
  let lastError: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const zai = await getZAI();

      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });

      const response = completion.choices?.[0]?.message?.content;
      if (!response || response.trim().length === 0) {
        throw new Error('AI returned empty response');
      }

      return response;
    } catch (err: any) {
      lastError = err;
      console.warn(`[ZAI Chat] Attempt ${attempt + 1} failed:`, err.message?.substring(0, 100));

      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error('AI service unavailable');
}

// ============ DATA CONTEXT FETCHERS ============

async function fetchSalesData(authHeader: string | null, origin: string): Promise<string> {
  try {
    const res = await fetch(`${origin}/api/ai/financial-snapshot`, {
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const json = await res.json();
    const data = json.data;
    if (!data) return '';

    const lines: string[] = [];
    lines.push('=== DATA TERKINI RAZKINDO ===');

    // Cash Pools
    if (data.cashPools) {
      const cp = data.cashPools;
      lines.push(`\n--- KEUANGAN ---`);
      lines.push(`Total penjualan: Rp ${Math.round(cp.totalSales || 0).toLocaleString('id-ID')} (${cp.totalTransactions || 0} transaksi)`);
      lines.push(`HPP di tangan: Rp ${Math.round(cp.hppInHand || 0).toLocaleString('id-ID')}`);
      lines.push(`Profit di tangan: Rp ${Math.round(cp.profitInHand || 0).toLocaleString('id-ID')}`);
      lines.push(`Total dibayar: Rp ${Math.round(cp.totalPaid || 0).toLocaleString('id-ID')}`);
      lines.push(`Total piutang: Rp ${Math.round(cp.totalReceivables || 0).toLocaleString('id-ID')}`);
    }

    // Account Balances
    if (data.accountBalances) {
      const ab = data.accountBalances;
      lines.push(`\nTotal saldo: Rp ${Math.round(ab.totalBalance || 0).toLocaleString('id-ID')}`);
      if (ab.bankAccounts?.length > 0) {
        ab.bankAccounts.filter((b: any) => b.isActive).forEach((b: any) => {
          lines.push(`Bank ${b.bankName}: Rp ${Math.round(b.balance || 0).toLocaleString('id-ID')}`);
        });
      }
    }

    // Sales Trend
    if (data.salesTrend?.length > 0) {
      lines.push(`\n--- TREN PENJUALAN ---`);
      data.salesTrend.forEach((m: any) => {
        const growth = m.salesGrowthPct !== null ? (m.salesGrowthPct >= 0 ? '▲' : '▼') : '';
        lines.push(`${m.month}: Rp ${Math.round(m.totalSales || 0).toLocaleString('id-ID')} ${growth}${Math.abs(m.salesGrowthPct || 0).toFixed(1)}% (${m.txCount} trx)`);
      });
    }

    // Top Products
    if (data.topProducts?.length > 0) {
      lines.push(`\n--- TOP PRODUK (90 hari) ---`);
      data.topProducts.slice(0, 5).forEach((p: any, i: number) => {
        lines.push(`${i + 1}. ${p.productName}: Rp ${Math.round(p.totalRevenue || 0).toLocaleString('id-ID')} (${p.totalQty} qty)`);
      });
    }

    // Purchase Recommendations
    if (data.purchaseRecommendations?.length > 0) {
      lines.push(`\n--- REKOMENDASI RESTOCK ---`);
      data.purchaseRecommendations.forEach((r: any) => {
        lines.push(`- ${r.productName}: stok ${r.currentStock}, sisa ${r.daysOfStock} hari → saran beli ${r.suggestedQty}, est. Rp ${Math.round(r.estimatedCost || 0).toLocaleString('id-ID')}`);
      });
    }

    // Low stock
    if (data.discrepancies) {
      lines.push(`\n--- STATUS ---`);
      lines.push(`Piutang aktif: ${data.discrepancies.totalUnpaidReceivables || 0}`);
    }

    lines.push('\n=== AKHIR DATA ===');
    return lines.join('\n');
  } catch (err) {
    console.error('[ZAI Chat] Failed to fetch data context:', err);
    return '';
  }
}

// ============ INTENT DETECTION ============

function needsDataContext(message: string): boolean {
  const q = message.toLowerCase();
  return !!(
    q.match(/penjualan|sales|jual|omset|revenue/) ||
    q.match(/stok|stock|inventory|persediaan/) ||
    q.match(/keuangan|financial|profit|laba|hpp/) ||
    q.match(/piutang|hutang|receivable|payable/) ||
    q.match(/analisa|analisis|review|laporan/) ||
    q.match(/rekomendasi|saran|restock|beli/) ||
    q.match(/tren|trend|pertumbuhan|growth/) ||
    q.match(/prediksi|forecast|predict/)
  );
}

// ============ MAIN HANDLER ============

export async function POST(request: NextRequest) {
  try {
    // 1. Verify auth
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized — silakan login terlebih dahulu' },
        { status: 401 }
      );
    }

    // 2. Check super_admin role
    const { data: authUser } = await db
      .from('users')
      .select('role, is_active, status')
      .eq('id', userId)
      .single();

    const isSuperAdmin = authUser?.role === 'super_admin' && authUser?.is_active && authUser?.status === 'approved';
    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: 'Akses ditolak — hanya Super Admin yang dapat menggunakan fitur ini' },
        { status: 403 }
      );
    }

    // 3. Parse request body
    const body = await request.json();
    const { message, history } = body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'Pesan wajib diisi' },
        { status: 400 }
      );
    }

    const userMessage = message.trim();
    const chatHistory = Array.isArray(history) ? history : [];

    // 4. Build messages for Z.ai
    const today = format(new Date(), 'EEEE, dd MMMM yyyy', { locale: id });
    const systemMsg = `${SYSTEM_PROMPT}\n\nINFO HARI INI: ${today}\n\nKamu sedang berbicara dengan Super Admin Razkindo. Berikan analisis mendalam dan rekomendasi yang actionable.`;

    const messages: { role: string; content: string }[] = [
      { role: 'assistant', content: systemMsg },
    ];

    // 5. Fetch data context if needed (for data-related queries)
    if (needsDataContext(userMessage)) {
      const authHeader = request.headers.get('authorization');
      const origin = new URL(request.url).origin;
      const dataContext = await fetchSalesData(authHeader, origin);
      if (dataContext) {
        messages.push({
          role: 'assistant',
          content: `DATA TERKINI YANG DAPAT KAMU GUNAKAN:\n\n${dataContext}\n\nGunakan data ini untuk menjawab pertanyaan user. Berikan analisis dan rekomendasi berdasarkan data.`
        });
      }
    }

    // 6. Add conversation history (last 10 messages)
    messages.push(
      ...chatHistory.slice(-10).map((m: any) => ({
        role: m.role,
        content: m.content,
      }))
    );

    // 7. Add current user message
    messages.push({ role: 'user', content: userMessage });

    // 8. Call Z.ai LLM
    const reply = await callZAIChat(messages);

    return NextResponse.json({ success: true, reply });
  } catch (error: any) {
    console.error('[ZAI Chat] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal memproses pesan. Silakan coba lagi.' },
      { status: 500 }
    );
  }
}
