---
Task ID: 1
Agent: Main Agent
Task: Rebuild pool dana system - complete overhaul

Work Log:
- Investigated all pool dana related files: API routes, components, RPCs
- Identified core issues: sync zeroing balances, manual update creating discrepancies, courier cash not showing properly, sales target bug
- Rebuilt `/api/finance/pools` GET handler: settings table as authoritative source, physical totals from server, pool vs physical discrepancy only
- Rebuilt sync preview: removed blocking safety checks, RPC values now labeled as "saran/referensi"
- Fixed manual update: after update, selisih = 0 by definition (settings is authority)
- Fixed discrepancy check in `/api/ai/discrepancy/route.ts`: pool vs physical is primary check, pool vs RPC is audit only
- Updated FinanceModule to use new API response structure
- Fixed sales target bug: table name `SalesTarget` (PascalCase) → `sales_targets` (snake_case) in PATCH/DELETE endpoints
- Fixed sales target auth: PATCH now allows admin/keuangan (not just super_admin)

Stage Summary:
- Pool dana system completely rebuilt with settings as authoritative source
- Selisih (discrepancy) now only shows for pool vs physical comparison
- Sync no longer blocks on zero values; warnings are informational only
- Courier cash properly tracked in dana kurir card
- Sales target bug fixed (wrong table name + auth issue)
- All TypeScript compilation passes, server running on port 3000
