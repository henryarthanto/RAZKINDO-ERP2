import { NextRequest, NextResponse } from 'next/server';
import { db, prisma } from '@/lib/supabase';
import { rowsToCamelCase, toCamelCase, toSnakeCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser, verifyAuthUser } from '@/lib/token';
import { wsStockUpdate } from '@/lib/ws-dispatch';
import { validateBody, validateQuery, productSchemas, commonSchemas } from '@/lib/validators';

export async function GET(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { user: authUser } = result;
    const isAdmin = authUser.role === 'super_admin';
    const isFinance = authUser.role === 'keuangan';

    const { searchParams } = new URL(request.url);
    const queryValidation = validateQuery(commonSchemas.pagination, searchParams);
    if (!queryValidation.success) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }
    const unitId = searchParams.get('unitId');
    const search = searchParams.get('search') || searchParams.get('q') || '';
    const category = searchParams.get('category') || '';
    const includeInactive = searchParams.get('includeInactive') === 'true';

    // Build Supabase query with optional filters
    // Use paginated fetch (batch 1000) to avoid silent truncation — Supabase caps at 1000 rows per request
    // When search or category filter is provided, 1000 rows is usually enough,
    // but when loading all products we paginate to get everything.
    const BATCH_SIZE = 1000;
    let allProductsCamel: any[] = [];

    // Only filter by is_active if not explicitly requesting inactive products
    // (includeInactive is only allowed for admin/finance)
    const filterActive = !includeInactive || (!isAdmin && !isFinance);

    // Server-side search filter
    const q = search.trim();
    // Server-side category filter
    const catFilter = category && category !== 'all' ? category : '';

    let page = 0;
    while (true) {
      let query = db
        .from('products')
        .select(`
          *,
          unit_products:unit_products(*, unit:units(*))
        `)
        .order('name', { ascending: true })
        .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);

      if (filterActive) query = query.eq('is_active', true);
      if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
      if (catFilter) query = query.eq('category', catFilter);

      const { data: batch, error: productsError } = await query;

      if (productsError) {
        console.error('[PRODUCTS] REST API query error:', productsError);
        // Fallback to Prisma if REST API fails
        try {
          const prismaWhere: any = {};
          if (filterActive) prismaWhere.isActive = true;
          if (q) {
            prismaWhere.OR = [
              { name: { contains: q, mode: 'insensitive' } },
              { sku: { contains: q, mode: 'insensitive' } },
            ];
          }
          if (catFilter) prismaWhere.category = catFilter;
          const prismaProducts = await prisma.product.findMany({
            where: prismaWhere,
            orderBy: { name: 'asc' },
            include: { unitProducts: { include: { unit: true } } },
          });
          const productsCamel = rowsToCamelCase(prismaProducts as any);
          return NextResponse.json({ products: productsCamel });
        } catch (prismaError) {
          console.error('[PRODUCTS] Prisma fallback also failed:', prismaError);
          return NextResponse.json({ error: 'Gagal memuat produk' }, { status: 500 });
        }
      }

      if (!batch || batch.length === 0) break;
      allProductsCamel.push(...rowsToCamelCase(batch));
      if (batch.length < BATCH_SIZE) break;
      page++;
      // Safety: stop after 10 batches (10,000 products) to prevent infinite loops
      if (page >= 10) {
        console.warn('[PRODUCTS] Reached 10,000 product limit, some products may be missing');
        break;
      }
    }

    const productsCamel = allProductsCamel;

    // If unitId filter is provided, enrich products with per-unit stock info
    let enrichedProducts = productsCamel;
    if (unitId) {
      enrichedProducts = productsCamel.map((p: any) => {
        const unitProduct = p.unitProducts?.find((up: any) => up.unitId === unitId);
        
        if (p.stockType === 'per_unit') {
          // Per-unit: show only this unit's stock
          return {
            ...p,
            effectiveStock: unitProduct?.stock || 0,
            effectiveHpp: unitProduct ? (p.avgHpp || 0) : 0,
            unitStock: unitProduct?.stock || 0,
            hasAccess: !!unitProduct
          };
        } else {
          // Centralized: show global stock
          return {
            ...p,
            effectiveStock: p.globalStock,
            effectiveHpp: p.avgHpp,
            unitStock: null,
            hasAccess: true
          };
        }
      });
    }

    // Strip HPP/cost data for sales and kurir roles (only super_admin + keuangan can see)
    const canSeeHpp = isAdmin || isFinance;
    if (!canSeeHpp) {
      enrichedProducts = enrichedProducts.map((p: any) => {
        const { avgHpp, effectiveHpp, unitProducts, ...rest } = p;
        // Also strip avgHpp from nested unitProducts entries
        return {
          ...rest,
          unitProducts: (unitProducts || []).map((up: any) => {
            const { avgHpp: _, ...upRest } = up;
            return upRest;
          }),
        };
      });
    }

    return NextResponse.json({ products: enrichedProducts });
  } catch (error) {
    console.error('Get products error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin, keuangan, or gudang can create products
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan', 'gudang'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin, Keuangan, atau Gudang yang dapat menambah produk' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validation = validateBody(productSchemas.create, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    const stockType = data.stockType || 'centralized';

    // Sequential operations (no transactions in Supabase JS)
    const productId = generateId();

    const { data: created, error: insertError } = await db
      .from('products')
      .insert({
        id: productId,
        name: data.name,
        sku: data.sku,
        description: data.description,
        category: data.category,
        unit: data.unit,
        subUnit: data.subUnit || null,
        conversionRate: data.conversionRate || 1,
        global_stock: data.globalStock || 0,
        avg_hpp: data.avgHpp || 0,
        selling_price: data.sellingPrice || 0,
        sell_price_per_sub_unit: data.sellPricePerSubUnit || 0,
        min_stock: data.minStock || 0,
        stock_type: stockType,
        track_stock: data.trackStock !== undefined ? data.trackStock : true,
        image_url: data.imageUrl || null
      })
      .select('*, unit_products:unit_products(*, unit:units(*))')
      .single();

    if (insertError) throw insertError;

    // For per_unit products, create UnitProduct entries for assigned units
    if (stockType === 'per_unit' && Array.isArray(data.assignedUnits) && data.assignedUnits.length > 0) {
      const existingUnitIds = (created.unit_products || []).map((up: any) => up.unit_id);
      const newUnitProducts = data.assignedUnits
        .filter((unitId: string) => !existingUnitIds.includes(unitId))
        .map((unitId: string) => ({
          id: generateId(),
          unit_id: unitId,
          product_id: productId,
          stock: data.initialStock || 0
        }));

      if (newUnitProducts.length > 0) {
        await db.from('unit_products').insert(newUnitProducts);
      }

      // Recalculate globalStock as sum of all unit stocks
      const { data: allUnitProducts } = await db
        .from('unit_products')
        .select('stock')
        .eq('product_id', productId);
      const totalStock = (allUnitProducts || []).reduce((sum: number, up: any) => sum + (up.stock || 0), 0);
      await db
        .from('products')
        .update({ global_stock: totalStock })
        .eq('id', productId);
    }

    // Create log
    createLog(db, {
      type: 'activity',
      action: 'product_created',
      entity: 'product',
      entityId: productId,
      message: `Product ${data.name} created (stockType: ${stockType})`
    });

    // Create event
    createEvent(db, 'product_created', { productId, name: data.name, stockType });

    // Fetch the final product with unitProducts
    const { data: finalProduct } = await db
      .from('products')
      .select(`
        *,
        unit_products:unit_products(*, unit:units(*))
      `)
      .eq('id', productId)
      .single();

    wsStockUpdate({ productId, productName: data.name });

    return NextResponse.json({ product: toCamelCase(finalProduct) });
  } catch (error) {
    console.error('Create product error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
