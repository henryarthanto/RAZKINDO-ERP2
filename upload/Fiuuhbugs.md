# 🔍 Razkindo ERP — Laporan Audit Bug & Panduan Penanganan

> **Versi Arsip:** `FIUUUHH.tar`  
> **Tanggal Audit:** 17 April 2026  
> **Status:** 15 bug ditemukan — 5 KRITIS (server mati + deploy gagal), 5 TINGGI, 5 SEDANG

---

## Ringkasan Eksekutif

Sistem mengalami **dua masalah utama**: server sering mati (OOM kill) dan selalu gagal deploy. Keduanya disebabkan oleh konfigurasi yang saling bertentangan antara `next.config.ts`, `package.json`, dan shell scripts. Selain itu, ditemukan bug keamanan serius (kredensial terekpose ke browser) dan bug finansial (`avgHpp` tidak dibalik dengan benar saat pembatalan pembelian).

---

## Daftar Bug

| No | Tingkat | Lokasi | Masalah |
|----|---------|--------|---------|
| BUG-01 | 🔴 KRITIS | `next.config.ts` | `output: 'standalone'` tidak ada → deploy selalu gagal |
| BUG-02 | 🔴 KRITIS | `package.json` | `prisma generate` tidak dipanggil saat build |
| BUG-03 | 🔴 KRITIS | `package.json` | Memory limit produksi 768MB → server OOM killed |
| BUG-04 | 🔴 KRITIS | `mini-services/event-queue` | Event-queue service tidak pernah distart |
| BUG-05 | 🔴 KRITIS | `.env` | `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` pakai publishable key + terekpose ke browser |
| BUG-06 | 🟠 TINGGI | `.env` | `WS_SECRET` tidak ada → fallback ke hardcoded default |
| BUG-07 | 🟠 TINGGI | `start-prod.sh` | Script bertentangan dengan `package.json` start |
| BUG-08 | 🟠 TINGGI | Semua shell scripts | Path hardcoded `/home/z/my-project` |
| BUG-09 | 🟠 TINGGI | `.env` | `SUPABASE_SESSION_POOL_URL` tidak ada |
| BUG-10 | 🟠 TINGGI | `instrumentation.ts` | Semua monitoring dinonaktifkan |
| BUG-11 | 🟠 TINGGI | `api/transactions/[id]/cancel/route.ts` | avgHpp tidak dibalik benar saat purchase dibatalkan |
| BUG-12 | 🟡 SEDANG | Semua shell scripts | 4 watchdog script saling bertentangan |
| BUG-13 | 🟡 SEDANG | `.env` | `AUTH_SECRET` & `NEXTAUTH_SECRET` nilai lemah |
| BUG-14 | 🟡 SEDANG | `.env` | Kredensial database committed ke repo |
| BUG-15 | 🟡 SEDANG | `next.config.ts` | `typescript.ignoreBuildErrors: true` |

---

## Detail Bug & Langkah Penanganan

---

### 🔴 BUG-01 — `output: 'standalone'` Tidak Ada di `next.config.ts`

**Dampak:** Deploy selalu gagal. `next build` tidak menghasilkan folder `.next/standalone/`, sehingga `bun .next/standalone/server.js` langsung crash dengan error `ENOENT: no such file or directory`.

**Penyebab:** `package.json` build script mengasumsikan standalone output:
```
"build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/"
"start": "... bun .next/standalone/server.js ..."
```
Tapi `next.config.ts` tidak memiliki `output: 'standalone'`.

**Fix — Edit `next.config.ts`:**
```typescript
const nextConfig: NextConfig = {
  output: 'standalone', // ← TAMBAHKAN INI
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ... sisanya tetap sama
};
```

---

### 🔴 BUG-02 — `prisma generate` Tidak Dipanggil Saat Build

**Dampak:** Pada fresh deploy, Prisma Client belum ter-generate. Semua operasi RPC (`decrement_stock`, `increment_stock_with_hpp`, `atomic_update_balance`, dll) gagal dengan error `Cannot find module '@prisma/client'` atau `PrismaClientInitializationError`. Login, transaksi, dan laporan semuanya tidak bisa jalan.

**Fix — Edit `package.json`:**
```json
{
  "scripts": {
    "build": "prisma generate && next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/",
    "start": "NODE_OPTIONS='--max-old-space-size=1536' NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
  }
}
```

---

### 🔴 BUG-03 — Memory Limit Produksi 768MB Terlalu Kecil (Server OOM)

**Dampak:** Server mati berulang kali. Next.js + Prisma + Socket.IO + connection pool + 30+ modul lib membutuhkan jauh lebih dari 768MB. OS akan kill proses saat melampaui limit, itulah kenapa "server sering mati".

**Bukti:** Script dev menggunakan `--max-old-space-size=4096` (4GB). Produksi dipaksa 768MB.

**Fix — Edit `package.json`:**
```json
"start": "NODE_OPTIONS='--max-old-space-size=1536' NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
```
Nilai 1536MB (1.5GB) adalah titik tengah yang wajar untuk Z AI. Naikkan ke 2048 jika masih crash.

**Tambahan — Buat `start-prod.sh` yang benar:**
```bash
#!/bin/bash
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"  # auto-detect path
cd "$PROJECT_DIR"

export NODE_ENV=production
export NODE_OPTIONS='--max-old-space-size=1536'
export $(grep -v '^#' .env | xargs)  # load semua env vars

# Jalankan event-queue service di background
echo "[Start] Menjalankan event-queue service..."
cd "$PROJECT_DIR/mini-services/event-queue"
bun index.ts &
EVENT_QUEUE_PID=$!
echo "[Start] Event-queue PID: $EVENT_QUEUE_PID"
cd "$PROJECT_DIR"

# Jalankan Next.js standalone server
echo "[Start] Menjalankan Next.js server..."
bun .next/standalone/server.js 2>&1 | tee server.log
```

---

### 🔴 BUG-04 — Event-Queue Service Tidak Pernah Distart

**Dampak:** Semua fitur real-time mati: notifikasi transaksi baru, update stok live, alert ke admin, dll. Setiap API route yang memanggil `wsEmit()` / `wsTransactionUpdate()` / `wsStockUpdate()` akan mendapat connection error ke `127.0.0.1:3004` — tapi ini silent (fire-and-forget) sehingga tidak terlihat jelas.

**Penyebab:** `ws-dispatch.ts` mengirim request ke port 3004, tapi tidak ada satu pun dari `start-prod.sh`, `start-server.sh`, atau `package.json` yang menjalankan `mini-services/event-queue/index.ts`.

**Fix — Tambahkan startup event-queue di `start-prod.sh`** (lihat BUG-03 fix di atas).

**Atau buat script terpisah `start-all.sh`:**
```bash
#!/bin/bash
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load env
export $(grep -v '^#' .env | xargs)

# 1. Jalankan event-queue service
echo "[1/2] Starting event-queue service on port 3004..."
cd "$PROJECT_DIR/mini-services/event-queue"
bun index.ts > "$PROJECT_DIR/event-queue.log" 2>&1 &
EQ_PID=$!
sleep 2

if ! kill -0 $EQ_PID 2>/dev/null; then
  echo "[ERROR] Event-queue gagal start. Cek event-queue.log"
  exit 1
fi
echo "[1/2] Event-queue OK (PID=$EQ_PID)"

# 2. Jalankan Next.js
echo "[2/2] Starting Next.js server on port 3000..."
cd "$PROJECT_DIR"
NODE_OPTIONS='--max-old-space-size=1536' NODE_ENV=production \
  bun .next/standalone/server.js 2>&1 | tee server.log
```

---

### 🔴 BUG-05 — `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` Salah Nilai + Terekpose ke Browser

**Dampak (ganda):**
1. **Keamanan:** Prefix `NEXT_PUBLIC_` menyebabkan variabel ini di-bundle ke JavaScript client-side. Siapapun yang membuka DevTools browser bisa melihatnya.
2. **Fungsional:** Nilainya adalah `sb_publishable_...` (anon/publishable key), BUKAN service role key. Supabase client berjalan dengan privilege anon, bukan admin — menyebabkan query yang membutuhkan bypass RLS gagal diam-diam.

**Bukti di `.env`:**
```
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=sb_publishable_aswVP7jZ9b-Lr7rMdvahXA_LkbBEy2n
                                       ^^^^^^^^^^^^^^^^^^^^ bukan service role key!
```

**Bukti di `supabase-rest.ts`:**
```typescript
export const SUPABASE_SERVICE_KEY: string = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
// Client dibuat dengan SUPABASE_SERVICE_KEY — seharusnya secret, tapi terekpose ke browser
```

**Fix — Ubah `.env` dan `supabase-rest.ts`:**

Di `.env`, ubah nama variabel (hilangkan `NEXT_PUBLIC_`):
```env
# HAPUS baris ini:
# NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=sb_publishable_...

# GANTI dengan (isi dengan service_role key asli dari Supabase Dashboard):
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  ← dari Supabase Dashboard > Settings > API
```

Di `src/lib/supabase-rest.ts`, baris 31:
```typescript
// SEBELUM (salah):
export const SUPABASE_SERVICE_KEY: string = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

// SESUDAH (benar):
export const SUPABASE_SERVICE_KEY: string = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
```

---

### 🟠 BUG-06 — `WS_SECRET` Tidak Ada di `.env`

**Dampak:** Event-queue service berjalan dengan secret default hardcoded `razkindo-erp-ws-secret-2024`. Siapapun yang tahu string ini bisa inject event palsu ke WebSocket.

**Fix — Tambahkan ke `.env`:**
```env
# WebSocket Event Queue
WS_SECRET=ganti-dengan-random-string-panjang-minimal-32-karakter
WS_PORT=3004
```

Generate nilai yang aman:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### 🟠 BUG-07 — `start-prod.sh` Bertentangan dengan `package.json` Start Script

**Dampak:** Dua cara menjalankan server yang incompatible. `start-prod.sh` menjalankan `npx next start` (butuh full `.next` folder, bukan standalone), tapi `package.json` start menjalankan `bun .next/standalone/server.js` (butuh standalone output).

**Bukti:**
```bash
# start-prod.sh (SALAH untuk standalone build):
npx next start -p 3000

# package.json start (standalone mode):
bun .next/standalone/server.js
```

**Fix — Ganti isi `start-prod.sh` sepenuhnya** dengan script dari BUG-03/BUG-04 fix di atas, yang menggunakan `bun .next/standalone/server.js` secara konsisten.

---

### 🟠 BUG-08 — Path Hardcoded `/home/z/my-project` di Semua Shell Scripts

**Dampak:** Jika Z AI mendeploy project ke path berbeda (contoh: `/home/user/razkindo` atau `/app`), semua script langsung gagal.

**File yang terdampak:**
- `start-dev.sh` — `cd /home/z/my-project`
- `start-server.sh` — `cd /home/z/my-project`
- `watchdog.sh` — `LOG=/home/z/my-project/dev.log`
- `dev-daemon.sh` — `LOG="/home/z/my-project/dev.log"`
- `dev-watch.sh` — `cd /home/z/my-project`

**Fix — Gunakan path dinamis di semua script:**
```bash
#!/bin/bash
# Ganti baris "cd /home/z/my-project" dengan:
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Dan ganti semua path hardcoded:
LOG="$PROJECT_DIR/dev.log"
PIDFILE="$PROJECT_DIR/.next-dev.pid"
```

---

### 🟠 BUG-09 — `SUPABASE_SESSION_POOL_URL` Tidak Ada di `.env`

**Dampak:** `connection-pool.ts` membutuhkan session-mode pooler (port 5432) untuk operasi DDL dan BEGIN/COMMIT. Karena `SUPABASE_SESSION_POOL_URL` tidak ada, ia fallback ke `SUPABASE_DB_URL` yang mengarah ke transaction-mode pooler (port 6543). PgBouncer transaction mode tidak mendukung prepared statements dan multi-statement transactions — menyebabkan error sporadis pada operasi kompleks.

**Fix — Tambahkan ke `.env`:**
```env
# Session pool (port 5432) untuk DDL dan multi-statement transactions
SUPABASE_SESSION_POOL_URL=postgresql://postgres.eglmvtleuonoeomovnwa:Arthanto01091987@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Bedanya dengan `SUPABASE_POOLER_URL` hanya di port: 5432 (session mode) vs 6543 (transaction mode).

---

### 🟠 BUG-10 — Semua Monitoring Dinonaktifkan di `instrumentation.ts`

**Dampak:** MemoryGuard tidak berjalan → tidak ada peringatan dini sebelum OOM. PerformanceMonitor tidak berjalan → tidak ada deteksi slow queries. Sistem berjalan buta tanpa telemetry apapun.

**Bukti di `instrumentation.ts`:**
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Skipping all instrumentation for debugging.');
    // Semua dikomentari...
  }
}
```

**Fix — Aktifkan kembali `instrumentation.ts`:**
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Memory monitoring (penting untuk deteksi OOM dini)
    const { memoryGuard } = await import('@/lib/memory-guard');
    memoryGuard.start(300_000); // check setiap 5 menit
    memoryGuard.onCritical(() => {
      if ((globalThis as any).gc) {
        try { (globalThis as any).gc(); } catch { /* ignore */ }
      }
    });

    console.log('[Instrumentation] Memory monitoring aktif.');
  }
}
```

---

### 🟠 BUG-11 — `avgHpp` Tidak Dibalik dengan Benar Saat Purchase Dibatalkan

**Dampak:** Setelah pembatalan transaksi pembelian, `avgHpp` (harga pokok rata-rata) produk tetap "terkontaminasi" oleh pembelian yang seharusnya sudah dibatalkan. Ini menyebabkan kalkulasi profit semua transaksi penjualan berikutnya menjadi salah.

**Penyebab di `api/transactions/[id]/cancel/route.ts`:**
```typescript
// Untuk purchase cancellation:
const removedValue = stockQty * (Number(itemCamel.hpp) || 0);
```

Masalahnya: `itemCamel.hpp` pada transaction item pembelian adalah HPP yang sudah dicatat saat pembelian diproses. Namun jika field ini `null` atau `0` (tidak tersimpan di `transaction_items` untuk pembelian), `removedValue = 0` dan `avgHpp` tidak berubah sama sekali. Stok berkurang tapi HPP tidak dibalik.

**Fix — Gunakan `price` (harga beli) dari item jika `hpp` nol, dan tambahkan guard:**

Di `api/transactions/[id]/cancel/route.ts`, pada blok `type === 'purchase'`, ganti:
```typescript
// SEBELUM:
const removedValue = stockQty * (Number(itemCamel.hpp) || 0);

// SESUDAH — fallback ke price (harga beli) jika hpp tidak tersimpan:
const itemCostPerUnit = Number(itemCamel.hpp) || Number(itemCamel.price) || 0;
const removedValue = stockQty * itemCostPerUnit;
```

Dan tambahkan guard agar avgHpp tidak negatif:
```typescript
if (newGlobalStock > 0 && oldGlobalStock > 0 && removedValue > 0) {
  const totalValueBefore = oldGlobalStock * oldAvgHpp;
  newAvgHpp = Math.max(0, Math.round((totalValueBefore - removedValue) / newGlobalStock));
} else if (newGlobalStock <= 0) {
  newAvgHpp = 0;
}
// else: jika removedValue = 0, avgHpp tidak diubah (lebih aman daripada corrupt)
```

---

### 🟡 BUG-12 — 4 Script Watchdog Saling Bertentangan

**Dampak:** Jika lebih dari satu script watchdog dijalankan bersamaan, terjadi race condition: keduanya mencoba membunuh dan merestart server di saat bersamaan, menyebabkan port 3000 terus-menerus di-rebind dan server tidak pernah stabil. Beberapa script juga menjalankan `rm -rf .next` yang menghapus cache build aktif.

**File terdampak:** `watchdog.sh`, `dev-daemon.sh`, `dev-watch.sh`, `start-server.sh`

**Fix — Konsolidasi menjadi SATU script. Gunakan `dev-daemon.sh` sebagai referensi (paling lengkap), hapus atau archive 3 lainnya. Tambahkan lock file:**
```bash
#!/bin/bash
LOCKFILE="/tmp/razkindo-dev.lock"
if [ -f "$LOCKFILE" ]; then
  echo "[ERROR] Dev server sudah berjalan (lock file ada). Hapus $LOCKFILE jika tidak."
  exit 1
fi
trap "rm -f $LOCKFILE" EXIT
touch "$LOCKFILE"

# ... (konten dev-daemon.sh)
```

---

### 🟡 BUG-13 — `AUTH_SECRET` dan `NEXTAUTH_SECRET` Nilai Lemah

**Dampak:** Nilai-nilai ini digunakan untuk menandatangani JWT token. Jika ditebak atau bocor, attacker bisa memalsukan token login untuk akun manapun.

**Fix — Generate nilai random yang kuat, perbarui `.env`:**
```bash
# Jalankan di terminal untuk generate secret baru:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Di `.env`:
```env
# GANTI dengan output dari perintah di atas:
AUTH_SECRET=<hasil_crypto_randomBytes_48_base64>
NEXTAUTH_SECRET=<hasil_crypto_randomBytes_48_lainnya>
```

---

### 🟡 BUG-14 — Kredensial Database Committed ke Repo

**Dampak:** Password database PostgreSQL (`Arthanto01091987`), VAPID private key, dan semua secret tersimpan di `.env` yang ikut dalam arsip. Jika repo ini pernah dipush ke GitHub/GitLab (bahkan private), kredensial bisa bocor.

**Fix:**

1. **Tambahkan `.env` ke `.gitignore`:**
```bash
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo "db/.auth-secret" >> .gitignore
```

2. **Buat `.env.example` (tanpa nilai):**
```env
DATABASE_URL=
DIRECT_URL=
SUPABASE_DB_URL=
SUPABASE_POOLER_URL=
SUPABASE_SESSION_POOL_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXTAUTH_SECRET=
AUTH_SECRET=
WS_SECRET=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

3. **Ganti password database di Supabase Dashboard** sekarang juga (anggap sudah bocor).

---

### 🟡 BUG-15 — `typescript.ignoreBuildErrors: true` Menyembunyikan Bug

**Dampak:** TypeScript errors diabaikan saat `next build`. Bug yang seharusnya tertangkap di compile-time (null reference, type mismatch, missing props) lolos ke production.

**Fix — Edit `next.config.ts`:**
```typescript
typescript: {
  ignoreBuildErrors: false, // ← ubah ke false
},
```

Jalankan `bun run build` dan perbaiki error yang muncul secara bertahap. Jika ada terlalu banyak, bisa pakai `// @ts-expect-error` secara selektif per baris daripada menonaktifkan semua pengecekan.

---

## Urutan Penanganan yang Direkomendasikan

Kerjakan dalam urutan ini agar deploy bisa berhasil sesegera mungkin:

```
HARI 1 — Perbaiki deploy dulu:
  1. BUG-01: Tambah output: 'standalone' ke next.config.ts
  2. BUG-02: Tambah prisma generate ke build script
  3. BUG-03: Naikkan memory limit ke 1536MB
  4. BUG-08: Ganti path hardcoded dengan path dinamis di semua scripts

HARI 1 — Setelah deploy berhasil:
  5. BUG-04: Aktifkan event-queue di start script
  6. BUG-06: Tambahkan WS_SECRET ke .env
  7. BUG-09: Tambahkan SUPABASE_SESSION_POOL_URL ke .env

HARI 2 — Keamanan & monitoring:
  8. BUG-05: Perbaiki NEXT_PUBLIC_ prefix + ganti dengan service_role key asli
  9. BUG-13: Generate AUTH_SECRET dan NEXTAUTH_SECRET baru
  10. BUG-14: Tambah .env ke .gitignore, ganti password DB
  11. BUG-10: Aktifkan kembali instrumentation.ts

HARI 3 — Stabilisasi:
  12. BUG-07: Hapus start-prod.sh lama, buat yang baru konsisten
  13. BUG-12: Konsolidasi 4 watchdog script menjadi 1
  14. BUG-11: Perbaiki avgHpp reversal pada purchase cancellation
  15. BUG-15: Set ignoreBuildErrors: false, perbaiki TS errors
```

---

## Konfigurasi `.env` Final yang Benar

Ini adalah template `.env` yang sudah diperbaiki (isi nilai yang kosong sesuai Supabase Dashboard):

```env
# ============================================================
# Database — Supabase PostgreSQL
# ============================================================
DATABASE_URL=postgresql://postgres.eglmvtleuonoeomovnwa:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.eglmvtleuonoeomovnwa:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.eglmvtleuonoeomovnwa.supabase.co:5432/postgres
SUPABASE_POOLER_URL=postgresql://postgres.eglmvtleuonoeomovnwa:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
SUPABASE_SESSION_POOL_URL=postgresql://postgres.eglmvtleuonoeomovnwa:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# ============================================================
# Supabase REST API
# ============================================================
NEXT_PUBLIC_SUPABASE_URL=https://eglmvtleuonoeomovnwa.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_aswVP7jZ9b-Lr7rMdvahXA_LkbBEy2n
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  ← dari Supabase Dashboard

# ============================================================
# Auth Secrets — WAJIB diganti dengan nilai random
# ============================================================
AUTH_SECRET=GANTI_DENGAN_CRYPTO_RANDOM_48_BYTES_BASE64
NEXTAUTH_SECRET=GANTI_DENGAN_CRYPTO_RANDOM_48_BYTES_BASE64_LAIN
NEXTAUTH_URL=http://localhost:3000

# ============================================================
# WebSocket Event Queue
# ============================================================
WS_SECRET=GANTI_DENGAN_CRYPTO_RANDOM_32_BYTES_HEX

# ============================================================
# Push Notifications (VAPID)
# ============================================================
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BB0HbTpIFv7pzW6ICkNJUGRVHVPiBmyoVuzkNlZ4kXC_uLYT7q-G5QlaKDKn4X7PvJojFuTmANOY9lbdqYG6x9A
VAPID_PRIVATE_KEY=oAXP_rWuBf1vqKYLZUGqwmrUAAJK50baFxb9buU1eqq
VAPID_SUBJECT=mailto:admin@razkindo.com
```

---

## Script Build + Start Final (Copy-Paste Ready)

### `package.json` (bagian scripts):
```json
"scripts": {
  "dev": "NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3000 --turbopack",
  "build": "prisma generate && next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/",
  "start": "NODE_OPTIONS='--max-old-space-size=1536' NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log",
  "start:all": "bash start-all.sh",
  "lint": "eslint .",
  "db:push": "prisma db push",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:reset": "prisma migrate reset"
}
```

### `next.config.ts` (baris yang perlu ditambah/ubah):
```typescript
const nextConfig: NextConfig = {
  output: 'standalone',          // ← TAMBAHKAN (BUG-01)
  typescript: {
    ignoreBuildErrors: false,    // ← UBAH ke false (BUG-15)
  },
  // ... sisanya tetap sama
};
```

### `start-all.sh` (script baru):
```bash
#!/bin/bash
set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Load environment variables
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

export NODE_ENV=production
export NODE_OPTIONS='--max-old-space-size=1536'

echo "=== Razkindo ERP Startup ==="

# 1. Event Queue Service
echo "[1/2] Starting event-queue service (port 3004)..."
cd "$PROJECT_DIR/mini-services/event-queue"
bun index.ts > "$PROJECT_DIR/event-queue.log" 2>&1 &
EQ_PID=$!

sleep 3
if ! kill -0 $EQ_PID 2>/dev/null; then
  echo "[ERROR] Event-queue gagal start! Lihat event-queue.log"
  exit 1
fi
echo "[1/2] Event-queue OK (PID=$EQ_PID)"

# 2. Next.js Standalone Server
echo "[2/2] Starting Next.js server (port 3000)..."
cd "$PROJECT_DIR"
bun .next/standalone/server.js 2>&1 | tee server.log

# Cleanup on exit
kill $EQ_PID 2>/dev/null
```

---

*Laporan ini dibuat berdasarkan analisis statis kode sumber. Selalu test di environment staging sebelum deploy ke production.*
