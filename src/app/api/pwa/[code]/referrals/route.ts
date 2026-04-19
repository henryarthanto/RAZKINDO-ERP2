import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Customer Referrals — Public (no auth, identified by code)
// GET /api/pwa/[code]/referrals — Returns customer's referrals
// POST /api/pwa/[code]/referrals — Creates new referral + auto-creates customer for super admin
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    const { data: referrals } = await db
      .from('customer_referral')
      .select(`
        *,
        referral_customer:customers!referral_customer_id(id, name, phone, code, status, assigned_to_id)
      `)
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Count by status
    const stats = {
      total: (referrals || []).length,
      new: (referrals || []).filter((r: any) => r.status === 'new').length,
      contacted: (referrals || []).filter((r: any) => r.status === 'contacted').length,
      converted: (referrals || []).filter((r: any) => r.status === 'converted').length,
      lost: (referrals || []).filter((r: any) => r.status === 'lost').length,
    };

    // Fetch referral bonus config
    const { data: refConfig } = await db
      .from('cashback_config')
      .select('referral_bonus_type, referral_bonus_value')
      .eq('is_active', true)
      .maybeSingle();

    return NextResponse.json({
      referrals: (referrals || []).map(r => ({
        ...toCamelCase(r),
        referralCustomer: toCamelCase(r.referral_customer || null),
      })),
      stats,
      referralConfig: refConfig ? toCamelCase(refConfig) : null,
    });
  } catch (error) {
    console.error('PWA referrals GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await request.json();

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // Validate
    if (!data.businessName || !data.picName || !data.phone) {
      return NextResponse.json({ error: 'Nama usaha, nama PIC, dan nomor HP wajib diisi' }, { status: 400 });
    }

    const phone = data.phone.replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 15) {
      return NextResponse.json({ error: 'Nomor HP tidak valid' }, { status: 400 });
    }

    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, unit_id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Check for duplicate referral with same phone from this customer
    const { data: existingReferral } = await db
      .from('customer_referral')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('phone', phone)
      .maybeSingle();

    if (existingReferral) {
      return NextResponse.json({ error: 'Referral dengan nomor telepon ini sudah pernah ditambahkan' }, { status: 400 });
    }

    // Find super admin in the same unit to assign the new customer to
    const { data: superAdmin } = await db
      .from('users')
      .select('id, name')
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .eq('unit_id', customer.unit_id)
      .limit(1)
      .maybeSingle();

    // Check if a customer with this phone already exists in the same unit
    const { data: existingCustomer } = await db
      .from('customers')
      .select('id, name, status')
      .eq('phone', phone)
      .eq('unit_id', customer.unit_id)
      .maybeSingle();

    let referralCustomerId: string | null = null;

    if (existingCustomer) {
      // Customer already exists — link to this referral
      referralCustomerId = existingCustomer.id;
    } else {
      // Auto-create new customer record assigned to super admin (status: inactive = prospect)
      const { data: newCustomer, error: custError } = await db
        .from('customers')
        .insert({
          id: generateId(),
          name: data.businessName.trim(),
          phone,
          unit_id: customer.unit_id,
          assigned_to_id: superAdmin?.id || null,
          status: 'inactive', // prospect/lead — not yet active
          distance: 'near',
          cashback_type: null,
          cashback_value: 0,
          cashback_balance: 0,
          total_orders: 0,
          total_spent: 0,
        })
        .select('id, code')
        .single();

      if (custError) {
        console.error('[PWA Referral] Failed to create customer:', custError.message);
        return NextResponse.json({ error: 'Gagal membuat data pelanggan referral' }, { status: 500 });
      }

      referralCustomerId = newCustomer.id;
    }

    // Create referral record
    const { data: referral, error } = await db
      .from('customer_referral')
      .insert({
        id: generateId(),
        customer_id: customer.id,
        business_name: data.businessName.trim(),
        pic_name: data.picName.trim(),
        phone,
        status: 'new',
        notes: data.notes || null,
        referral_customer_id: referralCustomerId,
      })
      .select()
      .single();

    if (error) {
      console.error('PWA referral create error:', error);
      return NextResponse.json({ error: 'Gagal mengirim referensi' }, { status: 500 });
    }

    // Create event notification for super admin to follow up
    createEvent(db, 'customer_referral_submitted', {
      referralId: referral.id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      businessName: data.businessName,
      picName: data.picName,
      phone,
      referralCustomerId,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      referral: toCamelCase(referral),
      message: 'Referensi berhasil dikirim! Pelanggan baru telah ditambahkan ke sistem.',
    });
  } catch (error) {
    console.error('PWA referrals POST error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
