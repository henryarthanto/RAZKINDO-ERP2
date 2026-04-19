'use client';

import { useState } from 'react';
import {
  ArrowDownCircle, CheckCircle2, XCircle, Clock, Eye,
  RefreshCw, Wallet, Landmark, Building2, Banknote,
  AlertCircle, ChevronDown,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { LoadingFallback } from '@/components/error-boundary';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

// =====================================================================
// TYPES
// =====================================================================

interface CashbackWithdrawalsTabProps {
  bankAccounts: Array<{ id: string; name: string; bankName: string; accountNo: string; balance: number }>;
  cashBoxes: Array<{ id: string; name: string; balance: number }>;
  poolBalances: { hppPaidBalance: number; profitPaidBalance: number };
}

interface Withdrawal {
  id: string;
  amount: number;
  bankName: string;
  accountNo: string;
  accountHolder: string;
  status: string;
  createdAt: string;
  customer: { name: string; phone: string; code: string };
  processedBy?: { name: string };
  sourceType?: string;
  bankAccountId?: string;
  cashBoxId?: string;
  bankAccount?: { id: string; name: string; bankName: string; accountNo: string };
  cashBox?: { id: string; name: string };
  rejectionReason?: string;
  notes?: string;
}

interface WithdrawalStats {
  totalPending?: number;
  totalPendingAmount?: number;
  processedCount?: number;
  rejectedCount?: number;
}

type WithdrawalStatus = 'pending' | 'approved' | 'processed' | 'rejected';
type SourceType = 'profit_paid' | 'hpp_paid';
type DestinationType = 'bank_account' | 'cash_box';

// =====================================================================
// STATUS BADGE
// =====================================================================

const STATUS_VARIANTS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200',
  processed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Disetujui',
  processed: 'Diproses',
  rejected: 'Ditolak',
};

function WithdrawalStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('text-xs font-medium whitespace-nowrap', STATUS_VARIANTS[status] || '')}>
      {status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
      {status === 'approved' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === 'processed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === 'rejected' && <XCircle className="w-3 h-3 mr-1" />}
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================

export default function CashbackWithdrawalsTab({
  bankAccounts,
  cashBoxes,
  poolBalances,
}: CashbackWithdrawalsTabProps) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  // ---- Dialog states ----
  const [rejectDialog, setRejectDialog] = useState<{
    id: string;
    customerName: string;
    amount: number;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [processDialog, setProcessDialog] = useState<{
    id: string;
    customer: Withdrawal['customer'];
    amount: number;
    bankName: string;
    accountNo: string;
    accountHolder: string;
  } | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('profit_paid');
  const [destinationType, setDestinationType] = useState<DestinationType>('bank_account');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  const [selectedCashBoxId, setSelectedCashBoxId] = useState<string>('');
  const [processNotes, setProcessNotes] = useState('');

  // ---- Fetch withdrawals ----
  const {
    data: withdrawalsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cashback-withdrawals', statusFilter],
    queryFn: () =>
      apiFetch<{
        withdrawals: Withdrawal[];
        stats: WithdrawalStats;
      }>(`/api/cashback/withdrawals${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`),
    ...POLLING_CONFIG,
  });

  const withdrawals = withdrawalsData?.withdrawals || [];
  const stats = withdrawalsData?.stats || {};

  // ---- Process mutation (approve / reject / process) ----
  const processMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) =>
      apiFetch<{ success: boolean; withdrawal: Withdrawal }>(
        `/api/cashback/withdrawals/${id}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: (_, variables) => {
      const status = variables.data.status as string;
      const messages: Record<string, string> = {
        approved: 'Pencairan berhasil disetujui',
        rejected: 'Pencairan berhasil ditolak',
        processed: 'Pembayaran cashback berhasil diproses',
      };
      toast.success(messages[status] || 'Status berhasil diupdate');
      queryClient.invalidateQueries({ queryKey: ['cashback-withdrawals'] });
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      closeAllDialogs();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal memproses pencairan');
    },
  });

  // ---- Helpers ----
  function closeAllDialogs() {
    setRejectDialog(null);
    setProcessDialog(null);
    setRejectReason('');
    setProcessNotes('');
    setSelectedBankAccountId('');
    setSelectedCashBoxId('');
    setSourceType('profit_paid');
    setDestinationType('bank_account');
  }

  function handleApprove(id: string) {
    processMutation.mutate({ id, data: { status: 'approved' } });
  }

  function handleReject() {
    if (!rejectDialog) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi');
      return;
    }
    processMutation.mutate({
      id: rejectDialog.id,
      data: { status: 'rejected', rejectionReason: rejectReason.trim() },
    });
  }

  function openProcessDialog(w: Withdrawal) {
    setProcessDialog({
      id: w.id,
      customer: w.customer,
      amount: w.amount,
      bankName: w.bankName,
      accountNo: w.accountNo,
      accountHolder: w.accountHolder,
    });
    setSourceType('profit_paid');
    setDestinationType('bank_account');
    setSelectedBankAccountId('');
    setSelectedCashBoxId('');
    setProcessNotes('');
  }

  function handleProcessPayment() {
    if (!processDialog) return;

    // Validate selections
    if (destinationType === 'bank_account' && !selectedBankAccountId) {
      toast.error('Pilih rekening bank tujuan');
      return;
    }
    if (destinationType === 'cash_box' && !selectedCashBoxId) {
      toast.error('Pilih brankas tujuan');
      return;
    }

    const payload: Record<string, unknown> = {
      status: 'processed',
      sourceType,
      destinationType,
      notes: processNotes.trim() || undefined,
    };

    if (destinationType === 'bank_account') {
      payload.bankAccountId = selectedBankAccountId;
    } else {
      payload.cashBoxId = selectedCashBoxId;
    }

    processMutation.mutate({ id: processDialog.id, data: payload });
  }

  function getSelectedDestinationBalance(): number {
    if (destinationType === 'bank_account') {
      const ba = bankAccounts.find((b) => b.id === selectedBankAccountId);
      return ba?.balance ?? 0;
    }
    const cb = cashBoxes.find((c) => c.id === selectedCashBoxId);
    return cb?.balance ?? 0;
  }

  function getSelectedDestinationName(): string {
    if (destinationType === 'bank_account') {
      const ba = bankAccounts.find((b) => b.id === selectedBankAccountId);
      return ba ? `${ba.name} (${ba.bankName})` : '-';
    }
    const cb = cashBoxes.find((c) => c.id === selectedCashBoxId);
    return cb?.name ?? '-';
  }

  // ---- Loading / Error states ----
  if (isLoading) {
    return <LoadingFallback message="Memuat data pencairan cashback..." />;
  }

  if (isError) {
    return (
      <Card className="border-red-200 bg-red-50 dark:bg-red-950/30">
        <CardContent className="p-6 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
          <p className="font-medium text-red-700 dark:text-red-400">Gagal memuat data</p>
          <p className="text-sm text-muted-foreground mt-1">
            {(error as any)?.message || 'Terjadi kesalahan saat memuat data pencairan.'}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Coba Lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Render ----
  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* ========== STATS BAR ========== */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {/* Pending Count */}
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-muted-foreground font-medium">Pending</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-amber-700 dark:text-amber-300">
              {stats.totalPending ?? 0}
            </p>
          </CardContent>
        </Card>

        {/* Total Pending Amount */}
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Wallet className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <p className="text-xs text-muted-foreground font-medium">Total Pending</p>
            </div>
            <p className="text-base sm:text-lg font-bold text-orange-700 dark:text-orange-300 truncate">
              {formatCurrency(stats.totalPendingAmount ?? 0)}
            </p>
          </CardContent>
        </Card>

        {/* Processed Count */}
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
              <p className="text-xs text-muted-foreground font-medium">Diproses</p>
            </div>
            <p className="text-lg sm:text-xl font-bold text-green-700 dark:text-green-300">
              {stats.processedCount ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ========== FILTER ========== */}
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Disetujui</SelectItem>
            <SelectItem value="processed">Diproses</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {withdrawals.length} data
        </span>
      </div>

      {/* ========== TABLE ========== */}
      <Card className="overflow-hidden min-w-0">
        <CardContent className="p-0 min-w-0">
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-sm min-w-[650px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Tanggal
                  </th>
                  <th className="text-left p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Pelanggan
                  </th>
                  <th className="text-right p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Jumlah
                  </th>
                  <th className="text-left p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Bank Tujuan
                  </th>
                  <th className="text-left p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-center p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      <ArrowDownCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>Tidak ada data pencairan</p>
                      <p className="text-xs mt-1">Perubahan filter akan memperbarui data</p>
                    </td>
                  </tr>
                ) : (
                  withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      {/* Date */}
                      <td className="p-3 whitespace-nowrap">
                        <p className="text-xs font-medium">{formatDateTime(w.createdAt)}</p>
                      </td>

                      {/* Customer */}
                      <td className="p-3 whitespace-nowrap">
                        <p className="font-medium truncate max-w-[150px]">
                          {w.customer?.name || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {w.customer?.code && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mr-1">
                              {w.customer.code}
                            </Badge>
                          )}
                          {w.customer?.phone || ''}
                        </p>
                      </td>

                      {/* Amount */}
                      <td className="p-3 text-right whitespace-nowrap font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(w.amount)}
                      </td>

                      {/* Bank details */}
                      <td className="p-3 whitespace-nowrap">
                        <p className="text-xs font-medium">{w.bankName || '-'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {w.accountHolder ? `${w.accountHolder} - ` : ''}
                          {w.accountNo}
                        </p>
                      </td>

                      {/* Status */}
                      <td className="p-3 whitespace-nowrap">
                        <WithdrawalStatusBadge status={w.status} />
                      </td>

                      {/* Actions */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* Pending: Approve + Reject */}
                          {w.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/40"
                                onClick={() => handleApprove(w.id)}
                                disabled={processMutation.isPending}
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Setujui
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={() =>
                                  setRejectDialog({
                                    id: w.id,
                                    customerName: w.customer?.name || '-',
                                    amount: w.amount,
                                  })
                                }
                                disabled={processMutation.isPending}
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Tolak
                              </Button>
                            </>
                          )}

                          {/* Approved: Process Pay */}
                          {w.status === 'approved' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              onClick={() => openProcessDialog(w)}
                              disabled={processMutation.isPending}
                            >
                              <Banknote className="w-3 h-3 mr-1" />
                              Proses Bayar
                            </Button>
                          )}

                          {/* Rejected: Show reason */}
                          {w.status === 'rejected' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() =>
                                toast.info(`Alasan: ${w.rejectionReason || 'Tidak ada alasan'}`)
                              }
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Alasan
                            </Button>
                          )}

                          {/* Processed: Show source/destination info */}
                          {w.status === 'processed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => {
                                const src = w.sourceType === 'hpp_paid'
                                  ? 'Pool HPP Sudah Dibayar'
                                  : 'Pool Profit Sudah Dibayar';
                                let dest = '-';
                                if (w.bankAccount) {
                                  dest = `${w.bankAccount.name} (${w.bankAccount.bankName})`;
                                } else if (w.cashBox) {
                                  dest = `Brankas: ${w.cashBox.name}`;
                                }
                                toast.info(`Sumber: ${src}\nTujuan: ${dest}${w.notes ? `\nCatatan: ${w.notes}` : ''}`);
                              }}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              Detail
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ========== REJECTION DIALOG ========== */}
      <Dialog
        open={!!rejectDialog}
        onOpenChange={(open) => {
          if (!open) {
            setRejectDialog(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="w-5 h-5" />
              Tolak Pencairan Cashback
            </DialogTitle>
            <DialogDescription>
              Tolak permintaan pencairan dari{' '}
              <strong>{rejectDialog?.customerName}</strong> sebesar{' '}
              <strong>{formatCurrency(rejectDialog?.amount ?? 0)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Alasan Penolakan <span className="text-red-500">*</span></Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Masukkan alasan penolakan..."
                rows={3}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Alasan ini akan ditampilkan ke pelanggan.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(''); }}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processMutation.isPending || !rejectReason.trim()}
            >
              {processMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Menolak...
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 mr-2" />
                  Tolak Pencairan
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========== PROCESSING DIALOG ========== */}
      <Dialog
        open={!!processDialog}
        onOpenChange={(open) => {
          if (!open) closeAllDialogs();
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Banknote className="w-5 h-5" />
              Proses Pencairan Cashback
            </DialogTitle>
            <DialogDescription>
              Proses pembayaran pencairan cashback ke rekening pelanggan
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-1">
            <div className="space-y-5 pb-2">
              {/* ---- Customer & Amount Summary ---- */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="w-4 h-4 text-muted-foreground" />
                  <span>Detail Pencairan</span>
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pelanggan</span>
                    <span className="font-medium text-right">
                      {processDialog?.customer?.name || '-'}
                      {processDialog?.customer?.code && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-2">
                          {processDialog.customer.code}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nominal</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">
                      {formatCurrency(processDialog?.amount ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bank Tujuan</span>
                    <span className="font-medium text-right">
                      {processDialog?.bankName} - {processDialog?.accountHolder}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">No. Rekening</span>
                    <span className="font-medium font-mono">{processDialog?.accountNo}</span>
                  </div>
                </div>
              </div>

              {/* ---- Step 1: Sumber Dana ---- */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    1
                  </span>
                  Sumber Dana (Pool)
                </div>
                <RadioGroup
                  value={sourceType}
                  onValueChange={(v) => setSourceType(v as SourceType)}
                  className="space-y-2"
                >
                  {/* Profit Paid */}
                  <Label
                    htmlFor="src-profit"
                    className={cn(
                      'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all',
                      sourceType === 'profit_paid'
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-400/30'
                        : 'border-muted hover:border-emerald-200 dark:hover:border-emerald-800'
                    )}
                  >
                    <RadioGroupItem value="profit_paid" id="src-profit" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        Profit Sudah Dibayar
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Saldo pool:{' '}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(poolBalances.profitPaidBalance)}
                        </span>
                      </p>
                    </div>
                  </Label>

                  {/* HPP Paid */}
                  <Label
                    htmlFor="src-hpp"
                    className={cn(
                      'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all',
                      sourceType === 'hpp_paid'
                        ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30 ring-1 ring-purple-400/30'
                        : 'border-muted hover:border-purple-200 dark:hover:border-purple-800'
                    )}
                  >
                    <RadioGroupItem value="hpp_paid" id="src-hpp" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        HPP Sudah Dibayar
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Saldo pool:{' '}
                        <span className="font-semibold text-purple-600 dark:text-purple-400">
                          {formatCurrency(poolBalances.hppPaidBalance)}
                        </span>
                      </p>
                    </div>
                  </Label>
                </RadioGroup>
              </div>

              <Separator />

              {/* ---- Step 2: Ambil Dari (Destination) ---- */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    2
                  </span>
                  Ambil Dari
                </div>
                <RadioGroup
                  value={destinationType}
                  onValueChange={(v) => {
                    setDestinationType(v as DestinationType);
                    setSelectedBankAccountId('');
                    setSelectedCashBoxId('');
                  }}
                  className="space-y-2"
                >
                  {/* Bank Account */}
                  <Label
                    htmlFor="dest-bank"
                    className={cn(
                      'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all',
                      destinationType === 'bank_account'
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-400/30'
                        : 'border-muted hover:border-blue-200 dark:hover:border-blue-800'
                    )}
                  >
                    <RadioGroupItem value="bank_account" id="dest-bank" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        Rekening Bank
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {bankAccounts.length === 0
                          ? 'Tidak ada rekening bank tersedia'
                          : `${bankAccounts.length} rekening tersedia`}
                      </p>
                    </div>
                  </Label>

                  {/* Cash Box */}
                  <Label
                    htmlFor="dest-cashbox"
                    className={cn(
                      'flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all',
                      destinationType === 'cash_box'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-400/30'
                        : 'border-muted hover:border-amber-200 dark:hover:border-amber-800'
                    )}
                  >
                    <RadioGroupItem value="cash_box" id="dest-cashbox" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <Banknote className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        Brankas / Kas
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cashBoxes.length === 0
                          ? 'Tidak ada brankas tersedia'
                          : `${cashBoxes.length} brankas tersedia`}
                      </p>
                    </div>
                  </Label>
                </RadioGroup>

                {/* Select destination */}
                {destinationType === 'bank_account' && (
                  <div className="space-y-2 ml-1">
                    <Label className="text-xs font-medium">Pilih Rekening Bank</Label>
                    {bankAccounts.length === 0 ? (
                      <div className="text-sm text-muted-foreground p-3 rounded-lg border border-dashed bg-muted/20 text-center">
                        <AlertCircle className="w-4 h-4 mx-auto mb-1 opacity-50" />
                        Belum ada rekening bank. Tambahkan di menu Keuangan.
                      </div>
                    ) : (
                      <Select
                        value={selectedBankAccountId}
                        onValueChange={setSelectedBankAccountId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pilih rekening..." />
                        </SelectTrigger>
                        <SelectContent>
                          {bankAccounts.map((ba) => (
                            <SelectItem key={ba.id} value={ba.id}>
                              <div className="flex items-center gap-2 w-full">
                                <span className="truncate">
                                  {ba.name} ({ba.bankName} - {ba.accountNo})
                                </span>
                                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                  {formatCurrency(ba.balance)}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {selectedBankAccountId && (
                      <p className="text-xs text-muted-foreground">
                        Saldo:{' '}
                        <span className="font-medium">
                          {formatCurrency(getSelectedDestinationBalance())}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {destinationType === 'cash_box' && (
                  <div className="space-y-2 ml-1">
                    <Label className="text-xs font-medium">Pilih Brankas</Label>
                    {cashBoxes.length === 0 ? (
                      <div className="text-sm text-muted-foreground p-3 rounded-lg border border-dashed bg-muted/20 text-center">
                        <AlertCircle className="w-4 h-4 mx-auto mb-1 opacity-50" />
                        Belum ada brankas. Tambahkan di menu Keuangan.
                      </div>
                    ) : (
                      <Select
                        value={selectedCashBoxId}
                        onValueChange={setSelectedCashBoxId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pilih brankas..." />
                        </SelectTrigger>
                        <SelectContent>
                          {cashBoxes.map((cb) => (
                            <SelectItem key={cb.id} value={cb.id}>
                              <div className="flex items-center gap-2 w-full">
                                <span className="truncate">{cb.name}</span>
                                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                  {formatCurrency(cb.balance)}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {selectedCashBoxId && (
                      <p className="text-xs text-muted-foreground">
                        Saldo:{' '}
                        <span className="font-medium">
                          {formatCurrency(getSelectedDestinationBalance())}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* ---- Notes ---- */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></Label>
                <Textarea
                  value={processNotes}
                  onChange={(e) => setProcessNotes(e.target.value)}
                  placeholder="Catatan pembayaran..."
                  rows={2}
                  className="resize-none"
                />
              </div>

              {/* ---- Validation warning ---- */}
              {(() => {
                const isReady =
                  (destinationType === 'bank_account' ? !!selectedBankAccountId : !!selectedCashBoxId);
                if (isReady && processDialog) {
                  const selectedBal = getSelectedDestinationBalance();
                  if (selectedBal < processDialog.amount) {
                    return (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-amber-700 dark:text-amber-400">
                              Saldo tidak mencukupi
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Saldo {getSelectedDestinationName()}: {formatCurrency(selectedBal)} — kurang {formatCurrency(processDialog.amount - selectedBal)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })()}
            </div>
          </ScrollArea>

          {/* ---- Dialog Actions ---- */}
          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2">
            <Button variant="outline" onClick={closeAllDialogs}>
              Batal
            </Button>
            <Button
              onClick={handleProcessPayment}
              disabled={
                processMutation.isPending ||
                (destinationType === 'bank_account' ? !selectedBankAccountId : !selectedCashBoxId)
              }
            >
              {processMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Proses Pembayaran
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
