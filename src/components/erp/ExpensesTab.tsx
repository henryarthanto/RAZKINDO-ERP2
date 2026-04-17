'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/erp-helpers';
import {
  Receipt,
  Plus,
  TrendingDown,
  Building2,
  Warehouse,
  CircleDollarSign,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { BankAccount, CashBox } from '@/types';

const EXPENSE_CATEGORIES = [
  { value: 'Operasional', label: 'Operasional' },
  { value: 'Transport', label: 'Transport' },
  { value: 'Makan', label: 'Makan' },
  { value: 'Listrik', label: 'Utilitas (Listrik/Air)' },
  { value: 'Sewa', label: 'Sewa' },
  { value: 'Peralatan', label: 'Peralatan' },
  { value: 'ATK', label: 'ATK' },
  { value: 'Internet', label: 'Internet' },
  { value: 'Maintenance', label: 'Perbaikan/Renovasi' },
  { value: 'Marketing', label: 'Marketing/Promosi' },
  { value: 'Lain-lain', label: 'Lainnya' },
];

interface ExpenseItem {
  id: string;
  invoiceNo: string;
  total: number;
  notes: string;
  transactionDate: string;
  unitId: string;
  unit?: { id: string; name: string };
  createdBy?: { id: string; name: string };
}

export default function ExpensesTab({
  bankAccounts,
  cashBoxes,
}: {
  bankAccounts: BankAccount[];
  cashBoxes: CashBox[];
}) {
  const { user } = useAuthStore();
  const { selectedUnitId, units } = useUnitStore();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formAmount, setFormAmount] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('Operasional');
  const [formUnitId, setFormUnitId] = useState(selectedUnitId || '');
  const [formFundSource, setFormFundSource] = useState<'hpp_paid' | 'profit_unpaid'>('hpp_paid');
  const [formSourceType, setFormSourceType] = useState<'bank' | 'cashbox'>('cashbox');
  const [formBankAccountId, setFormBankAccountId] = useState('');
  const [formCashBoxId, setFormCashBoxId] = useState('');

  // Fetch expenses
  const { data: expensesData, isLoading } = useQuery({
    queryKey: ['expenses', page],
    queryFn: () => apiFetch<{
      expenses: ExpenseItem[];
      totalExpenses: number;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/finance/expenses?page=${page}&limit=20`),
    ...POLLING_CONFIG,
  });

  const expenses = expensesData?.expenses || [];
  const totalExpenses = expensesData?.totalExpenses || 0;
  const pagination = expensesData?.pagination || { page: 1, totalPages: 1, total: 0 };

  // Create expense mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/expenses', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Pengeluaran berhasil dicatat');
      setShowForm(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Gagal mencatat pengeluaran');
    },
  });

  const resetForm = () => {
    setFormAmount('');
    setFormDesc('');
    setFormCategory('Operasional');
    setFormUnitId(selectedUnitId || '');
    setFormFundSource('hpp_paid');
    setFormSourceType('cashbox');
    setFormBankAccountId('');
    setFormCashBoxId('');
  };

  const handleSubmit = () => {
    if (!formAmount || parseFloat(formAmount) <= 0) {
      toast.error('Jumlah pengeluaran harus lebih dari 0');
      return;
    }
    if (!formDesc.trim()) {
      toast.error('Deskripsi pengeluaran wajib diisi');
      return;
    }
    if (!formUnitId) {
      toast.error('Unit/Cabang wajib dipilih');
      return;
    }

    createMutation.mutate({
      amount: parseFloat(formAmount),
      description: formDesc.trim(),
      unitId: formUnitId,
      fundSource: formFundSource,
      sourceType: formSourceType,
      bankAccountId: formSourceType === 'bank' ? formBankAccountId : undefined,
      cashBoxId: formSourceType === 'cashbox' ? formCashBoxId : undefined,
      category: formCategory || undefined,
    });
  };

  const extractCategory = (notes: string) => {
    const match = notes?.match(/\[(\w[\w\s]*)\]/);
    return match ? match[1] : null;
  };

  const getCategoryLabel = (cat: string | null) => {
    if (!cat) return 'Lain-lain';
    const found = EXPENSE_CATEGORIES.find(c => c.value === cat);
    return found?.label || cat;
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Pengeluaran</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-300">{formatCurrency(totalExpenses)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Jumlah Transaksi</p>
              <p className="text-lg font-bold text-orange-700 dark:text-orange-300">{pagination.total}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Expense Button */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
        <DialogTrigger asChild>
          <Button className="w-full sm:w-auto gap-2 bg-red-600 hover:bg-red-700">
            <Plus className="w-4 h-4" />
            Catat Pengeluaran
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Catat Pengeluaran Baru
            </DialogTitle>
            <DialogDescription>
              Pengeluaran akan langsung diproses dan mengurangi saldo pool dana serta rekening/brankas
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Amount */}
            <div className="space-y-2">
              <Label>Jumlah Pengeluaran *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                <Input
                  type="number"
                  className="pl-10 text-lg font-semibold"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  placeholder="0"
                  min={0}
                />
              </div>
            </div>

            {/* Category & Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Unit/Cabang *</Label>
                <Select value={formUnitId} onValueChange={setFormUnitId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Deskripsi *</Label>
              <Textarea
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="Deskripsi pengeluaran (mis: Bayar listrik bulan Maret)"
                rows={2}
              />
            </div>

            <Separator />

            {/* 2-Step Workflow Info */}
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <p className="font-semibold mb-1">💡 2-Step Workflow:</p>
              <p><strong>Step 1:</strong> Pilih sumber pool dana (HPP/Profit)</p>
              <p><strong>Step 2:</strong> Pilih rekening/brankas fisik untuk pembayaran</p>
            </div>

            {/* Step 1: Fund Source */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] flex items-center justify-center font-bold">1</span>
                Komposisi Dana
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormFundSource('hpp_paid')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    formFundSource === 'hpp_paid' ? 'border-purple-500 bg-purple-50 dark:bg-purple-950' : 'border-muted hover:border-purple-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <CircleDollarSign className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold">HPP Terbayar</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Dana dari cost recovery</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFormFundSource('profit_unpaid')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    formFundSource === 'profit_unpaid' ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-muted hover:border-teal-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-4 h-4 text-teal-600" />
                    <span className="text-xs font-semibold">Profit Terbayar</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Dana dari keuntungan</p>
                </button>
              </div>
            </div>

            {/* Step 2: Physical Source */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold">2</span>
                Keluarkan Dari
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormSourceType('bank')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    formSourceType === 'bank' ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'border-muted hover:border-green-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Building2 className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-semibold">Rekening Bank</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormSourceType('cashbox')}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    formSourceType === 'cashbox' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950' : 'border-muted hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Warehouse className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-semibold">Brankas/Kas</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Select specific account */}
            {formSourceType === 'bank' && (
              <div className="space-y-2">
                <Label>Pilih Rekening Bank *</Label>
                <Select value={formBankAccountId} onValueChange={setFormBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih rekening" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.filter((b: BankAccount) => b.isActive).map((b: BankAccount) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.bankName}) — {formatCurrency(b.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formSourceType === 'cashbox' && (
              <div className="space-y-2">
                <Label>Pilih Brankas/Kas *</Label>
                <Select value={formCashBoxId} onValueChange={setFormCashBoxId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih brankas" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashBoxes.filter((c: CashBox) => c.isActive).map((c: CashBox) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {formatCurrency(c.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700"
            >
              {createMutation.isPending ? 'Menyimpan...' : 'Catat Pengeluaran'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Riwayat Pengeluaran</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Memuat data...</div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>Belum ada pengeluaran</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {expenses.map((exp: ExpenseItem) => {
                const category = extractCategory(exp.notes || '');
                const cleanNotes = (exp.notes || '').replace(/\s*\[[\w\s]*\]\s*$/, '');
                return (
                  <div key={exp.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900 flex items-center justify-center shrink-0 mt-0.5">
                      <ArrowUpRight className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{cleanNotes || exp.invoiceNo}</p>
                        {category && (
                          <Badge variant="outline" className="text-[10px] shrink-0">{getCategoryLabel(category)}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span>{exp.invoiceNo}</span>
                        <span>•</span>
                        <span>{formatDate(exp.transactionDate)}</span>
                        {exp.unit?.name && (
                          <>
                            <span>•</span>
                            <span>{exp.unit.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="font-bold text-sm text-red-600 dark:text-red-400 shrink-0">
                      -{formatCurrency(exp.total)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">
                Halaman {pagination.page} dari {pagination.totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
