// =====================================================================
// MIGRATE DATA FROM SUPABASE TO LOCAL POSTGRESQL
// =====================================================================
// Run: npx tsx scripts/migrate-from-supabase.ts
//
// This script:
// 1. Connects to remote Supabase via REST API (no direct DB connection needed)
// 2. Downloads all data from key tables
// 3. Inserts into local PostgreSQL via Prisma
// 4. Skips duplicates (by unique constraint)
// =====================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Supabase REST API config (from .env)
const _supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const _supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!_supabaseUrl || !_supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const SUPABASE_URL: string = _supabaseUrl;
const SUPABASE_KEY: string = _supabaseKey;

// Simple Supabase REST fetcher
async function supabaseFetch(table: string, select = '*', order?: string, limit = 10000): Promise<any[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('select', select);
  url.searchParams.set('limit', String(limit));
  if (order) url.searchParams.set('order', order);

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase query failed for ${table}: ${res.status} - ${text}`);
  }

  return res.json();
}

// Convert snake_case row to camelCase for Prisma
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function rowToCamel(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = toCamelCase(key);
    // Convert ISO date strings to Date objects for Prisma
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      result[camelKey] = new Date(value);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

// Migration stats
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;

async function migrateTable<T>(
  tableName: string,
  select: string,
  model: any,
  order: string,
  transform?: (row: any) => any,
) {
  console.log(`\n📦 Migrating ${tableName}...`);
  try {
    const rows = await supabaseFetch(tableName, select, order);
    console.log(`   Found ${rows.length} rows`);

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const data = transform ? transform(row) : rowToCamel(row);
        // Try to create, skip if unique constraint violation
        await model.create({ data });
        inserted++;
      } catch (err: any) {
        if (err.message?.includes('Unique constraint') || err.code === 'P2002') {
          skipped++;
        } else {
          console.error(`   ❌ Error on row:`, err.message?.substring(0, 100));
          totalErrors++;
        }
      }
    }

    totalInserted += inserted;
    totalSkipped += skipped;
    console.log(`   ✅ Inserted: ${inserted}, Skipped: ${skipped}`);
  } catch (err: any) {
    console.error(`   ❌ Failed to fetch ${tableName}:`, err.message);
    totalErrors++;
  }
}

async function main() {
  console.log('=====================================================================');
  console.log(' MIGRATING DATA FROM SUPABASE TO LOCAL POSTGRESQL');
  console.log('=====================================================================');
  console.log(`Supabase URL: ${SUPABASE_URL}`);

  // Test local DB connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Local PostgreSQL connected');
  } catch (err) {
    console.error('❌ Cannot connect to local PostgreSQL. Check DATABASE_URL in .env');
    process.exit(1);
  }

  // Test Supabase connection
  try {
    await supabaseFetch('settings', 'key', 'key', 1);
    console.log('✅ Supabase REST API connected');
  } catch (err) {
    console.error('❌ Cannot connect to Supabase REST API. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // ── Migrate in dependency order ──

  // 1. Custom Roles (no dependencies)
  await migrateTable(
    'custom_roles', '*', prisma.customRole,
    'created_at',
  );

  // 2. Units (no dependencies)
  await migrateTable(
    'units', '*', prisma.unit,
    'created_at',
  );

  // 3. Settings (no dependencies)
  await migrateTable(
    'settings', '*', prisma.setting,
    'key',
  );

  // 4. Products (no dependencies)
  await migrateTable(
    'products', '*', prisma.product,
    'created_at',
  );

  // 5. Unit Products (depends on products + units)
  await migrateTable(
    'unit_products', '*', prisma.unitProduct,
    'created_at',
  );

  // 6. Customers (depends on units)
  await migrateTable(
    'customers', '*', prisma.customer,
    'created_at',
  );

  // 7. Suppliers
  await migrateTable(
    'suppliers', '*', prisma.supplier,
    'created_at',
  );

  // 8. Users (depends on units, custom_roles)
  await migrateTable(
    'users', '*', prisma.user,
    'created_at',
  );

  // 9. User Units (depends on users + units)
  await migrateTable(
    'user_units', '*', prisma.userUnit,
    'created_at',
  );

  // 10. Bank Accounts
  await migrateTable(
    'bank_accounts', '*', prisma.bankAccount,
    'created_at',
  );

  // 11. Cash Boxes
  await migrateTable(
    'cash_boxes', '*', prisma.cashBox,
    'created_at',
  );

  // 12. Transactions (depends on customers, units, users)
  await migrateTable(
    'transactions', '*', prisma.transaction,
    'created_at',
  );

  // 13. Transaction Items (depends on transactions, products)
  await migrateTable(
    'transaction_items', '*', prisma.transactionItem,
    'created_at',
  );

  // 14. Payments (depends on transactions, users)
  await migrateTable(
    'payments', '*', prisma.payment,
    'created_at',
  );

  // 15. Receivables (depends on transactions, customers)
  await migrateTable(
    'receivables', '*', prisma.receivable,
    'created_at',
  );

  // 16. Salary Payments
  await migrateTable(
    'salary_payments', '*', prisma.salaryPayment,
    'created_at',
  );

  // 17. Finance Requests
  await migrateTable(
    'finance_requests', '*', prisma.financeRequest,
    'created_at',
  );

  // 18. Fund Transfers
  await migrateTable(
    'fund_transfers', '*', prisma.fundTransfer,
    'created_at',
  );

  // 19. Company Debts
  await migrateTable(
    'company_debts', '*', prisma.companyDebt,
    'created_at',
  );

  // 20. Company Debt Payments
  await migrateTable(
    'company_debt_payments', '*', prisma.companyDebtPayment,
    'created_at',
  );

  // 21. Sales Targets
  await migrateTable(
    'sales_targets', '*', prisma.salesTarget,
    'created_at',
  );

  // 22. Courier Cash
  await migrateTable(
    'courier_cash', '*', prisma.courierCash,
    'created_at',
  );

  // 23. Courier Handovers
  await migrateTable(
    'courier_handovers', '*', prisma.courierHandover,
    'created_at',
  );

  // 24. Cashback Configs
  await migrateTable(
    'cashback_configs', '*', prisma.cashbackConfig,
    'created_at',
  );

  // 25. Cashback Logs
  await migrateTable(
    'cashback_logs', '*', prisma.cashbackLog,
    'created_at',
  );

  // 26. Chat Rooms
  await migrateTable(
    'chat_rooms', '*', prisma.chatRoom,
    'created_at',
  );

  // 27. Chat Messages
  await migrateTable(
    'chat_messages', '*', prisma.chatMessage,
    'created_at',
  );

  console.log('\n=====================================================================');
  console.log(' MIGRATION COMPLETE');
  console.log('=====================================================================');
  console.log(`✅ Total inserted: ${totalInserted}`);
  console.log(`⏭️  Total skipped (duplicates): ${totalSkipped}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log('=====================================================================');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
