// =====================================================================
// PUSH NOTIFICATION - Web Push library for sending notifications
// =====================================================================
// Uses web-push (VAPID) to send push notifications to subscribed users.
// Works on Android (Chrome/Firefox), iOS (Safari 16.4+), macOS (Safari/Chrome).
// =====================================================================

import webpush from 'web-push';
import { db } from '@/lib/supabase';

// VAPID Configuration
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@razkindo.com';

let configured = false;

/**
 * Initialize VAPID credentials - call once at startup
 */
export function initVapid(): void {
  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    configured = true;
    console.log('[Push] VAPID configured successfully');
  } else {
    console.warn('[Push] VAPID keys not configured - push notifications disabled');
  }
}

// Auto-initialize on import
if (typeof window === 'undefined') {
  initVapid();
}

/**
 * Push notification payload interface
 */
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
  url?: string;
  actions?: Array<{ action: string; title: string }>;
  requireInteraction?: boolean;
}

/**
 * Event type to notification message mapping
 * Maps internal event types to user-friendly push notifications
 */
const EVENT_NOTIFICATION_MAP: Record<string, (payload: any) => Omit<PushPayload, 'icon' | 'badge'>> = {
  transaction_created: (p) => ({
    title: '🛒 Transaksi Baru',
    body: `${p.createdBy || 'Sales'} membuat penjualan ${formatRp(p.total || 0)}`,
    tag: 'transaction',
    url: '/',
  }),
  transaction_approved: (p) => ({
    title: '✅ Transaksi Disetujui',
    body: `${p.invoiceNo || '-'} sebesar ${formatRp(p.total || 0)}`,
    tag: 'transaction',
    url: '/',
  }),
  transaction_cancelled: (p) => ({
    title: '❌ Transaksi Dibatalkan',
    body: `${p.invoiceNo || '-'} dibatalkan`,
    tag: 'transaction',
    url: '/',
  }),
  transaction_delivered: (p) => ({
    title: '🚚 Pesanan Dikirim',
    body: `${p.courierName || 'Kurir'} mengirim ke ${p.customerName || ''} (${formatRp(p.amount || 0)})`,
    tag: 'delivery',
    url: '/',
  }),
  transaction_marked_lunas: (p) => ({
    title: '🎉 Lunas!',
    body: `${p.invoiceNo || '-'} telah lunas ${formatRp(p.total || 0)}`,
    tag: 'payment',
    url: '/',
  }),
  payment_received: (p) => ({
    title: '💰 Pembayaran Diterima',
    body: `${formatRp(p.amount || 0)} untuk ${p.invoiceNo || '-'}`,
    tag: 'payment',
    url: '/',
  }),
  payment_proof_uploaded: (p) => ({
    title: '📸 Bukti Bayar Masuk',
    body: `${p.customerName || 'Konsumen'} mengirim bukti bayar ${p.invoiceNo || '-'}`,
    tag: 'payment',
    requireInteraction: true,
    url: '/',
  }),
  payment_proof_needed: (p) => ({
    title: '📋 Perlu Konfirmasi Pembayaran',
    body: `Pembayaran untuk ${p.invoiceNo || '-'} menunggu verifikasi`,
    tag: 'payment',
    requireInteraction: true,
    url: '/',
  }),
  salary_request_created: (p) => ({
    title: '📋 Request Gaji Baru',
    body: `${p.userName || 'Karyawan'} mengajukan gaji ${formatRp(p.amount || 0)}`,
    tag: 'salary',
    url: '/',
  }),
  salary_paid: (p) => ({
    title: '💵 Gaji Dibayar',
    body: `Gaji ${p.userName || 'karyawan'} ${formatRp(p.amount || 0)} telah dibayar`,
    tag: 'salary',
    url: '/',
  }),
  finance_request_created: (p) => ({
    title: '📝 Request Baru',
    body: `Request ${p.type || ''} sebesar ${formatRp(p.amount || 0)}`,
    tag: 'finance',
    url: '/',
  }),
  finance_request_approved: (p) => ({
    title: '✅ Request Disetujui',
    body: `Request ${p.type || ''} ${formatRp(p.amount || 0)} disetujui`,
    tag: 'finance',
    url: '/',
  }),
  finance_request_rejected: (p) => ({
    title: '🚫 Request Ditolak',
    body: `Request ${p.type || ''} ${formatRp(p.amount || 0)} ditolak`,
    tag: 'finance',
    url: '/',
  }),
  finance_request_processed: (p) => ({
    title: '💳 Pembayaran Diproses',
    body: `${p.type || ''} ${formatRp(p.amount || 0)} selesai diproses`,
    tag: 'finance',
    url: '/',
  }),
  stock_low: (p) => ({
    title: '⚠️ Stok Rendah',
    body: `${p.productName || 'Produk'} stok ${p.currentStock || 0} (min ${p.minStock || 0})`,
    tag: 'stock',
    url: '/',
  }),
  product_created: (p) => ({
    title: '📦 Produk Baru',
    body: `"${p.name || '-'}" ditambahkan`,
    tag: 'product',
    url: '/',
  }),
  user_approved: (p) => ({
    title: '👤 User Baru',
    body: `${p.userName || 'User'} telah disetujui`,
    tag: 'user',
    url: '/',
  }),
  pwa_order_pending: (p) => ({
    title: '🛍️ Pesanan Online Baru',
    body: `Pesanan dari ${p.customerName || 'Pelanggan'}`,
    tag: 'pwa',
    requireInteraction: true,
    url: '/',
  }),
  pwa_order_approved: (p) => ({
    title: '✅ Pesanan Online Diproses',
    body: `Pesanan ${p.invoiceNo || '-'} sedang diproses`,
    tag: 'pwa',
    url: '/',
  }),
  cashback_withdrawal_requested: (p) => ({
    title: '💸 Permintaan Tarik Cashback',
    body: `${p.customerName || 'Pelanggan'} menarik cashback ${formatRp(p.amount || 0)}`,
    tag: 'cashback',
    url: '/',
  }),
};

/**
 * Format currency in Indonesian Rupiah (compact)
 */
function formatRp(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

/**
 * Get notification payload for an event type
 */
export function getEventNotification(type: string, payload: any): PushPayload | null {
  const mapper = EVENT_NOTIFICATION_MAP[type];
  if (!mapper) return null; // Unknown event types don't get push

  const mapped = mapper(payload || {});
  return {
    icon: '/logo.svg',
    badge: '/logo.svg',
    ...mapped,
    data: {
      type,
      payload,
      timestamp: Date.now(),
      url: mapped.url || '/',
    },
  };
}

/**
 * Send push notification to all active subscribers
 * Invalid/expired subscriptions are automatically cleaned up
 */
export async function sendPushToAll(payload: PushPayload): Promise<{
  sent: number;
  failed: number;
  cleaned: number;
}> {
  if (!configured) {
    console.log('[Push] Skipping - VAPID not configured');
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  try {
    // Fetch all active subscriptions from Supabase
    const { data: subscriptions, error } = await db
      .from('push_subscriptions')
      .select('id, endpoint, keys_p256dh, keys_auth');

    if (error) {
      console.error('[Push] Failed to fetch subscriptions:', error.message);
      return { sent: 0, failed: 0, cleaned: 0 };
    }

    if (!subscriptions || subscriptions.length === 0) {
      return { sent: 0, failed: 0, cleaned: 0 };
    }

    return await sendToSubscriptions(subscriptions, payload);
  } catch (err) {
    console.error('[Push] sendPushToAll error:', err);
    return { sent: 0, failed: 0, cleaned: 0 };
  }
}

/**
 * Send push notification to a specific user (all their devices)
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number; cleaned: number }> {
  if (!configured) {
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  try {
    const { data: subscriptions, error } = await db
      .from('push_subscriptions')
      .select('id, endpoint, keys_p256dh, keys_auth')
      .eq('user_id', userId);

    if (error || !subscriptions || subscriptions.length === 0) {
      return { sent: 0, failed: 0, cleaned: 0 };
    }

    return await sendToSubscriptions(subscriptions, payload);
  } catch (err) {
    console.error('[Push] sendPushToUser error:', err);
    return { sent: 0, failed: 0, cleaned: 0 };
  }
}

/**
 * Send push notification for a newly created event
 * Call this after createEvent() to also push to subscribed devices
 */
export async function sendEventPush(eventType: string, eventPayload: any): Promise<void> {
  const notification = getEventNotification(eventType, eventPayload);
  if (!notification) return;

  // Fire and forget - don't block the main flow
  sendPushToAll(notification).then((result) => {
    if (result.sent > 0 || result.cleaned > 0) {
      console.log(
        `[Push] Event "${eventType}": sent=${result.sent}, failed=${result.failed}, cleaned=${result.cleaned}`
      );
    }
  }).catch(() => {});
}

/**
 * Internal: send to a list of subscriptions and clean up invalid ones
 */
async function sendToSubscriptions(
  subscriptions: Array<{ id: string; endpoint: string; keys_p256dh: string; keys_auth: string }>,
  payload: PushPayload
): Promise<{ sent: number; failed: number; cleaned: number }> {
  const pushPayload = JSON.stringify(payload);
  const ttl = payload.requireInteraction ? 86400 : 3600; // 24h for important, 1h for normal
  const invalidIds: string[] = [];

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys_p256dh,
              auth: sub.keys_auth,
            },
          },
          pushPayload,
          {
            TTL: ttl,
            urgency: payload.requireInteraction ? 'high' : 'normal',
          }
        );
      } catch (err: any) {
        // 404/410 = subscription expired or invalid → mark for cleanup
        if (err.statusCode === 404 || err.statusCode === 410) {
          invalidIds.push(sub.id);
        }
        throw err;
      }
    })
  );

  // Clean up invalid subscriptions in background
  let cleaned = 0;
  if (invalidIds.length > 0) {
    try {
      const { error } = await db
        .from('push_subscriptions')
        .delete()
        .in('id', invalidIds);
      if (!error) cleaned = invalidIds.length;
    } catch {
      // Best effort cleanup
    }
  }

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length - cleaned;

  return { sent, failed, cleaned };
}

/**
 * Check if push notifications are configured and available
 */
export function isPushConfigured(): boolean {
  return configured;
}
