---
Task ID: 1
Agent: Main Agent
Task: Fix pool dana komposisi dana - sync menghasilkan 0, selisih -290.000, reset 0, dan sales target bug

Work Log:
- Investigated pool dana sync logic: found RPC `get_payment_pool_sums` via Prisma + Supabase REST fallback
- Discovered root cause of sync→0: previous fallback only counted payments with cashBoxId/bankAccountId (ignoring handovers), so when all payments go via courier → 0
- Fixed fallback in `fetchPoolSumsFromPrisma()` to include courier handovers via Supabase REST queries
- Fixed `computeSyncPreview()` to include `courierSums.hppPending + courierSums.profitPending` in suggested values → totalPool = totalPhysical → selisih = 0
- Fixed manual update dialog to include courier cash in totalPhysical (brankas + bank + kurir)
- Removed `reset_to_zero` action from backend POST handler
- Removed Reset 0 button and AlertDialog from frontend FinanceModule
- Removed `RotateCcw` import and `resetPoolsMutation` / `showResetConfirm` state
- Fixed pool settings directly in DB (HPP=175000, Profit=115000) to restore correct values
- Added debug logging to `fetchPoolSumsFromPrisma()` for future troubleshooting
- Fixed sales target API: added `createdAt`/`updatedAt` to Supabase REST insert (required since REST doesn't auto-generate)
- Fixed sales target PATCH/DELETE routes: changed wrong table name `sales_targets` → correct `SalesTarget`

Stage Summary:
- Pool dana sync now correctly includes handover + courier pending → selisih = 0 after sync
- Manual update includes courier cash in totalPhysical → no discrepancy after manual update
- Reset 0 functionality completely removed
- Sales target POST/PATCH/DELETE routes fixed (table name + timestamps)
- All changes compile without TypeScript errors
