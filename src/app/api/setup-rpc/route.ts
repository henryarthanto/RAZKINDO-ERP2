import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getSessionPool } from '@/lib/connection-pool';
import { enforceSuperAdmin } from '@/lib/require-auth';

// POST /api/setup-rpc
// Deploys atomic RPC functions to Supabase
// BUG FIX #4: Added enforceSuperAdmin guard to prevent unauthorized access
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const rpcStatements = [
      `CREATE OR REPLACE FUNCTION decrement_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric;
BEGIN
  UPDATE products
  SET global_stock = global_stock - p_qty
  WHERE id = p_product_id AND global_stock >= p_qty
  RETURNING global_stock INTO v_new_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stok tidak cukup untuk produk %', p_product_id;
  END IF;
END;
$$;`,
      `CREATE OR REPLACE FUNCTION increment_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET global_stock = global_stock + p_qty
  WHERE id = p_product_id;
END;
$$;`,
      // --- Atomic balance update for cash_boxes / bank_accounts ---
      `CREATE OR REPLACE FUNCTION atomic_update_balance(
  p_table text,
  p_id text,
  p_delta numeric,
  p_min numeric DEFAULT 0
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance numeric;
  v_balance_col text;
BEGIN
  IF p_table = 'cash_boxes' OR p_table = 'bank_accounts' THEN
    v_balance_col := 'balance';
  ELSE
    RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  EXECUTE format('UPDATE %I SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= $3 RETURNING balance', p_table)
    INTO v_new_balance USING p_delta, p_id, p_min;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient balance or record not found';
  END IF;

  RETURN v_new_balance;
END;
$$;`,
      // --- Atomic setting balance update (pool balances stored as plain text numbers) ---
      `CREATE OR REPLACE FUNCTION atomic_update_setting_balance(
  p_key text,
  p_delta numeric,
  p_min numeric DEFAULT 0
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current numeric;
  v_new_balance numeric;
  v_raw_value text;
BEGIN
  SELECT value INTO v_raw_value FROM settings WHERE key = p_key;

  -- Try to parse as number: plain string or JSON
  BEGIN
    v_current := v_raw_value::numeric;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_current := (v_raw_value::json)::text::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_current := 0;
    END;
  END;

  v_current := COALESCE(v_current, 0);
  v_new_balance := v_current + p_delta;

  IF v_new_balance < p_min THEN
    RAISE EXCEPTION 'Insufficient pool balance. Current: %, Attempted change: %', v_current, p_delta;
  END IF;

  INSERT INTO settings (key, value) VALUES (p_key, v_new_balance::text)
  ON CONFLICT (key) DO UPDATE SET value = v_new_balance::text;

  RETURN v_new_balance;
END;
$$;`,
      // --- Dashboard summary: single-query aggregation for all KPIs ---
      `CREATE OR REPLACE FUNCTION get_dashboard_summary(p_unit_id text DEFAULT NULL, p_filter_start timestamptz DEFAULT NULL, p_filter_end timestamptz DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'totalSales', COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0),
    'totalProfit', COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_profit ELSE 0 END), 0),
    'totalTransactions', COUNT(*),
    'todaySales', COALESCE(SUM(CASE WHEN transaction_date >= CURRENT_DATE AND status != 'cancelled' THEN total ELSE 0 END), 0),
    'todayProfit', COALESCE(SUM(CASE WHEN transaction_date >= CURRENT_DATE AND status != 'cancelled' THEN total_profit ELSE 0 END), 0),
    'pendingApprovals', COUNT(*) FILTER (WHERE status = 'pending'),
    'receivables', COUNT(*) FILTER (WHERE payment_status != 'paid' AND status = 'approved')
  ) INTO result
  FROM transactions
  WHERE type = 'sale'
    AND (p_unit_id IS NULL OR unit_id = p_unit_id)
    AND (p_filter_start IS NULL OR transaction_date >= p_filter_start)
    AND (p_filter_end IS NULL OR transaction_date < p_filter_end + INTERVAL '1 day');
  RETURN result;
END;
$$;`,
      // --- Low stock count: single-query for products at or below minimum stock ---
      `CREATE OR REPLACE FUNCTION get_low_stock_count(p_unit_id text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  cnt integer;
BEGIN
  SELECT COUNT(*) INTO cnt FROM products WHERE is_active = true AND global_stock <= COALESCE(min_stock, 0);
  RETURN cnt;
END;
$$;`,
      // --- Batch update transaction items: single-query for PWA order approval ---
      `CREATE OR REPLACE FUNCTION update_transaction_items_batch(p_items jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE transaction_items ti SET
    price = (p_item->>'price')::numeric,
    hpp = (p_item->>'hpp')::numeric,
    subtotal = (p_item->>'subtotal')::numeric,
    profit = (p_item->>'profit')::numeric
  FROM jsonb_array_elements(p_items) AS p_item
  WHERE ti.id = (p_item->>'id')::text::uuid;
END;
$$;`,
      // --- Decrement unit (per-branch) stock atomically ---
      `CREATE OR REPLACE FUNCTION decrement_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_new_stock numeric;
BEGIN
  UPDATE unit_products
  SET stock = stock - p_qty
  WHERE id = p_unit_product_id AND stock >= p_qty
  RETURNING stock INTO v_new_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stok unit tidak cukup (unit_product_id: %)', p_unit_product_id;
  END IF;
END;
$$;`,
      // --- Increment unit (per-branch) stock atomically ---
      `CREATE OR REPLACE FUNCTION increment_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE unit_products
  SET stock = stock + p_qty
  WHERE id = p_unit_product_id;
END;
$$;`,
      // --- Recalculate global stock from all unit_products ---
      `CREATE OR REPLACE FUNCTION recalc_global_stock(p_product_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total numeric;
BEGIN
  SELECT COALESCE(SUM(stock), 0) INTO v_total
  FROM unit_products WHERE product_id = p_product_id;
  UPDATE products SET global_stock = v_total WHERE id = p_product_id;
END;
$$;`,
      // --- Increment stock with HPP recalculation ---
      `CREATE OR REPLACE FUNCTION increment_stock_with_hpp(p_product_id text, p_qty numeric, p_new_hpp numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_current_stock numeric;
  v_current_hpp numeric;
  v_new_global_stock numeric;
  v_new_avg_hpp numeric;
BEGIN
  SELECT global_stock, avg_hpp INTO v_current_stock, v_current_hpp
  FROM products WHERE id = p_product_id;

  v_new_global_stock := COALESCE(v_current_stock, 0) + p_qty;

  IF p_qty > 0 AND p_new_hpp > 0 THEN
    v_new_avg_hpp := (COALESCE(v_current_stock, 0) * COALESCE(v_current_hpp, 0) + p_qty * p_new_hpp) / v_new_global_stock;
  ELSE
    v_new_avg_hpp := COALESCE(v_current_hpp, 0);
  END IF;

  UPDATE products
  SET global_stock = v_new_global_stock, avg_hpp = v_new_avg_hpp
  WHERE id = p_product_id;
END;
$$;`,
      // --- Optimization indexes for high-traffic queries ---
      `CREATE INDEX IF NOT EXISTS idx_transactions_customer_status ON transactions(customer_id, type, status, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_type_status_date ON transactions(type, status, payment_method, transaction_date);`,
      `CREATE INDEX IF NOT EXISTS idx_receivables_transaction ON receivables(transaction_id);`,
      `CREATE INDEX IF NOT EXISTS idx_receivables_assigned_status ON receivables(assigned_to_id, status);`,
      `CREATE INDEX IF NOT EXISTS idx_tx_items_product_date ON transaction_items(product_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(code) WHERE code IS NOT NULL;`,
    ];

    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      return NextResponse.json({
        success: false,
        error: 'SUPABASE_DB_URL tidak tersedia. Jalankan manual via SQL Editor.',
        sql: rpcStatements,
      }, { status: 400 });
    }

    // Use session pool for DDL (CREATE OR REPLACE FUNCTION) and NOTIFY
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
    });
    const client = await pool.connect();

    try {
      for (const sql of rpcStatements) {
        await client.query(sql);
      }

      // Notify PostgREST to reload schema on same connection
      await client.query('NOTIFY pgrst, \'reload schema\'');

      return NextResponse.json({
        success: true,
        message: 'RPC functions deployed successfully',
        functions: ['decrement_stock', 'increment_stock', 'decrement_unit_stock', 'increment_unit_stock', 'recalc_global_stock', 'increment_stock_with_hpp', 'atomic_update_balance', 'atomic_update_setting_balance', 'get_dashboard_summary', 'get_low_stock_count', 'update_transaction_items_batch'],
        indexes: ['idx_transactions_customer_status', 'idx_transactions_type_status_date', 'idx_receivables_transaction', 'idx_receivables_assigned_status', 'idx_tx_items_product_date', 'idx_customers_code'],
      });
    } catch (error: any) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
