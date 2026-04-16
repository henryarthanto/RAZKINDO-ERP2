import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { createLog } from '@/lib/supabase-helpers';

// GET /api/finance/pools
// Returns current pool balances for the 2-step finance workflow:
// - hppPaidBalance: HPP Sudah Terbayar (cost recovery from customer payments)
// - profitPaidBalance: Profit Sudah Terbayar (profit from customer payments)
// - investorFund: Dana Lain-lain (investor, pinjaman, dll)
// - totalPool: hppPaidBalance + profitPaidBalance + investorFund
// - actualHppSum: SUM of hpp_portion from all payments (ground truth)
// - actualProfitSum: SUM of profit_portion from all payments (ground truth)
export async function GET(request: NextRequest) {
  try {
    // Bug #1 FIX: Use verifyAuthUser (any auth'd user) instead of enforceFinanceRole
    // The pool read-only data is useful for all roles (dashboard, etc.)
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // OPTIMIZATION: Use RPC instead of full table scan on payments table
    const { data: sumsData, error: sumsError } = await db.rpc('get_payment_pool_sums');
    let actualHppSum = sumsData?.hppPaidTotal || 0;
    let actualProfitSum = sumsData?.profitPaidTotal || 0;
    if (sumsError) {
      console.error('[POOL] RPC get_payment_pool_sums failed, falling back to direct query:', sumsError.message);
      // Fallback: direct aggregate query (still better than full scan)
      const { data: fallback } = await db.from('payments').select('hpp_portion, profit_portion');
      actualHppSum = fallback?.reduce((sum: number, p: any) => sum + (Number(p.hpp_portion) || 0), 0) || 0;
      actualProfitSum = fallback?.reduce((sum: number, p: any) => sum + (Number(p.profit_portion) || 0), 0) || 0;
    }

    // Bug #2 FIX: Read pool balances from settings table
    const { data: settings } = await db
      .from('settings')
      .select('key, value')
      .in('key', [
        'pool_hpp_paid_balance',
        'pool_profit_paid_balance',
        'pool_investor_fund',
      ]);

    const getVal = (key: string) => {
      const s = settings?.find((s: any) => s.key === key);
      return s ? (parseFloat(JSON.parse(s.value)) || 0) : 0;
    };

    let hppPaidBalance = getVal('pool_hpp_paid_balance');
    let profitPaidBalance = getVal('pool_profit_paid_balance');
    const investorFund = getVal('pool_investor_fund');

    // Bug #2 FIX: Auto-initialize pool balances from actual payment sums if they are zero
    // This ensures first-time users see correct values without needing to manually sync
    if (hppPaidBalance === 0 && profitPaidBalance === 0 && (actualHppSum > 0 || actualProfitSum > 0)) {
      const roundedHpp = Math.round(actualHppSum);
      const roundedProfit = Math.round(actualProfitSum);
      await db.from('settings').upsert(
        { key: 'pool_hpp_paid_balance', value: JSON.stringify(roundedHpp) },
        { onConflict: 'key' }
      );
      await db.from('settings').upsert(
        { key: 'pool_profit_paid_balance', value: JSON.stringify(roundedProfit) },
        { onConflict: 'key' }
      );
      console.log(`[POOL] Auto-initialized pool balances from actual sums: HPP=${roundedHpp}, Profit=${roundedProfit}`);
      hppPaidBalance = roundedHpp;
      profitPaidBalance = roundedProfit;
    }

    return NextResponse.json({
      hppPaidBalance,
      profitPaidBalance,
      investorFund,
      totalPool: hppPaidBalance + profitPaidBalance + investorFund,
      actualHppSum,
      actualProfitSum,
      actualTotal: actualHppSum + actualProfitSum,
    });
  } catch (error) {
    console.error('Get pool balances error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PUT /api/finance/pools
// Manually update pool balances:
// - HPP + Profit + Dana Lain-lain = Total Pool
// - Dana Lain-lain bersifat independent (additive, tidak dikurangi dari fisik)
// - HPP + Profit dapat di-auto-kalkulasi dari totalPool - investorFund
export async function PUT(request: NextRequest) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      hppPaidBalance,
      profitPaidBalance,
      investorFund: investorFundInput,
      totalPhysical,
    } = body;

    // Read current investor fund if not provided
    let investorFund = investorFundInput;
    if (investorFund === undefined || investorFund === null) {
      const { data: current } = await db
        .from('settings')
        .select('value')
        .eq('key', 'pool_investor_fund')
        .maybeSingle();
      investorFund = current ? (parseFloat(JSON.parse(current.value)) || 0) : 0;
    } else {
      investorFund = Math.max(0, Math.round(Number(investorFund)));
    }

    // If totalPhysical is provided, HPP + Profit + Dana Lain-lain = totalPhysical
    // Auto-calculate the missing HPP or Profit value
    if (totalPhysical !== undefined && totalPhysical !== null) {
      const totalPhysicalNum = Math.round(Number(totalPhysical));
      const investorSafe = Math.max(0, investorFund);

      // Total for HPP+Profit = totalPhysical - investorFund
      const poolFromOps = Math.max(0, totalPhysicalNum - investorSafe);

      let finalHpp: number;
      let finalProfit: number;

      if (hppPaidBalance !== undefined && hppPaidBalance !== null) {
        finalHpp = Math.max(0, Math.round(Number(hppPaidBalance)));
        if (finalHpp > poolFromOps) {
          return NextResponse.json({
            error: `HPP (${finalHpp.toLocaleString('id-ID')}) + Dana Lain-lain (${investorSafe.toLocaleString('id-ID')}) = ${(finalHpp + investorSafe).toLocaleString('id-ID')} melebihi total fisik (${totalPhysicalNum.toLocaleString('id-ID')})`
          }, { status: 400 });
        }
        finalProfit = Math.max(0, Math.round(poolFromOps - finalHpp));
      } else if (profitPaidBalance !== undefined && profitPaidBalance !== null) {
        finalProfit = Math.max(0, Math.round(Number(profitPaidBalance)));
        if (finalProfit > poolFromOps) {
          return NextResponse.json({
            error: `Profit (${finalProfit.toLocaleString('id-ID')}) + Dana Lain-lain (${investorSafe.toLocaleString('id-ID')}) = ${(finalProfit + investorSafe).toLocaleString('id-ID')} melebihi total fisik (${totalPhysicalNum.toLocaleString('id-ID')})`
          }, { status: 400 });
        }
        finalHpp = Math.max(0, Math.round(poolFromOps - finalProfit));
      } else {
        // No HPP or Profit provided — only update investor fund
        const { data: currentHpp } = await db.from('settings').select('value').eq('key', 'pool_hpp_paid_balance').maybeSingle();
        const { data: currentProfit } = await db.from('settings').select('value').eq('key', 'pool_profit_paid_balance').maybeSingle();
        finalHpp = currentHpp ? (parseFloat(JSON.parse(currentHpp.value)) || 0) : 0;
        finalProfit = currentProfit ? (parseFloat(JSON.parse(currentProfit.value)) || 0) : 0;
      }

      // Validate total doesn't exceed physical
      const totalPool = finalHpp + finalProfit + investorSafe;
      if (totalPool > totalPhysicalNum) {
        return NextResponse.json({
          error: `Total Pool (${totalPool.toLocaleString('id-ID')}) melebihi total dana fisik (${totalPhysicalNum.toLocaleString('id-ID')})`
        }, { status: 400 });
      }

      // Update all three settings
      await db.from('settings').upsert(
        { key: 'pool_hpp_paid_balance', value: JSON.stringify(finalHpp) },
        { onConflict: 'key' }
      );
      await db.from('settings').upsert(
        { key: 'pool_profit_paid_balance', value: JSON.stringify(finalProfit) },
        { onConflict: 'key' }
      );
      await db.from('settings').upsert(
        { key: 'pool_investor_fund', value: JSON.stringify(investorSafe) },
        { onConflict: 'key' }
      );

      // Log
      try {
        createLog(db, {
          type: 'audit',
          action: 'pool_balances_updated',
          entity: 'settings',
          entityId: 'pool_hpp_paid_balance',
          userId: auth.userId,
          message: `Pool dana diperbarui: HPP=${finalHpp.toLocaleString('id-ID')}, Profit=${finalProfit.toLocaleString('id-ID')}, Dana Lain-lain=${investorSafe.toLocaleString('id-ID')}, Total=${totalPool.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      return NextResponse.json({
        hppPaidBalance: finalHpp,
        profitPaidBalance: finalProfit,
        investorFund: investorSafe,
        totalPool,
        message: `Pool dana berhasil diperbarui. Total: ${totalPool.toLocaleString('id-ID')}`
      });
    }

    // If only investorFund is provided (standalone investor fund update)
    if (investorFundInput !== undefined && hppPaidBalance === undefined && profitPaidBalance === undefined) {
      await db.from('settings').upsert(
        { key: 'pool_investor_fund', value: JSON.stringify(investorFund) },
        { onConflict: 'key' }
      );

      // Read current HPP + Profit for total
      const { data: currentHpp } = await db.from('settings').select('value').eq('key', 'pool_hpp_paid_balance').maybeSingle();
      const { data: currentProfit } = await db.from('settings').select('value').eq('key', 'pool_profit_paid_balance').maybeSingle();
      const currentHppVal = currentHpp ? (parseFloat(JSON.parse(currentHpp.value)) || 0) : 0;
      const currentProfitVal = currentProfit ? (parseFloat(JSON.parse(currentProfit.value)) || 0) : 0;
      const totalPool = currentHppVal + currentProfitVal + investorFund;

      try {
        createLog(db, {
          type: 'audit',
          action: 'investor_fund_updated',
          entity: 'settings',
          entityId: 'pool_investor_fund',
          userId: auth.userId,
          message: `Dana lain-lain diperbarui: ${investorFund.toLocaleString('id-ID')}. Total pool: ${totalPool.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      return NextResponse.json({
        hppPaidBalance: currentHppVal,
        profitPaidBalance: currentProfitVal,
        investorFund,
        totalPool,
        message: `Dana lain-lain berhasil diperbarui: ${investorFund.toLocaleString('id-ID')}`
      });
    }

    return NextResponse.json({ error: 'Parameter tidak valid' }, { status: 400 });
  } catch (error) {
    console.error('Update pool balances error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// POST /api/finance/pools
// Sync pool balances from actual payment sums (auto-sync)
// Recalculates hppPaidBalance and profitPaidBalance from SUM of payments
export async function POST(request: NextRequest) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { action } = body;

    if (action === 'sync_from_payments') {
      // OPTIMIZATION: Use RPC instead of full table scan on payments table
      const { data: sumsData, error: sumsError } = await db.rpc('get_payment_pool_sums');
      let newHpp = sumsData?.hppPaidTotal || 0;
      let newProfit = sumsData?.profitPaidTotal || 0;
      if (sumsError) {
        console.error('[POOL SYNC] RPC failed, falling back to direct query:', sumsError.message);
        const { data: fallback } = await db.from('payments').select('hpp_portion, profit_portion');
        newHpp = fallback?.reduce((sum: number, p: any) => sum + (Number(p.hpp_portion) || 0), 0) || 0;
        newProfit = fallback?.reduce((sum: number, p: any) => sum + (Number(p.profit_portion) || 0), 0) || 0;
      }

      const roundedHpp = Math.round(newHpp);
      const roundedProfit = Math.round(newProfit);

      // Read current investor fund
      const { data: current } = await db
        .from('settings')
        .select('value')
        .eq('key', 'pool_investor_fund')
        .maybeSingle();
      const investorFund = current ? (parseFloat(JSON.parse(current.value)) || 0) : 0;

      // Update HPP and Profit pool balances
      await db.from('settings').upsert(
        { key: 'pool_hpp_paid_balance', value: JSON.stringify(roundedHpp) },
        { onConflict: 'key' }
      );
      await db.from('settings').upsert(
        { key: 'pool_profit_paid_balance', value: JSON.stringify(roundedProfit) },
        { onConflict: 'key' }
      );

      const totalPool = roundedHpp + roundedProfit + investorFund;

      // Log
      try {
        createLog(db, {
          type: 'audit',
          action: 'pool_synced_from_payments',
          entity: 'settings',
          entityId: 'pool_hpp_paid_balance',
          userId: auth.userId,
          message: `Pool dana disinkronkan dari pembayaran: HPP=${roundedHpp.toLocaleString('id-ID')}, Profit=${roundedProfit.toLocaleString('id-ID')}, Dana Lain-lain=${investorFund.toLocaleString('id-ID')}, Total=${totalPool.toLocaleString('id-ID')}`
        });
      } catch { /* ignore */ }

      return NextResponse.json({
        hppPaidBalance: roundedHpp,
        profitPaidBalance: roundedProfit,
        investorFund,
        totalPool,
        message: `Pool dana berhasil disinkronkan dari data pembayaran. HPP: ${roundedHpp.toLocaleString('id-ID')}, Profit: ${roundedProfit.toLocaleString('id-ID')}`
      });
    }

    return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 });
  } catch (error) {
    console.error('Sync pool balances error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
