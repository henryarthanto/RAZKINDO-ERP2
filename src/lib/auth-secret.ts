// Centralized AUTH_SECRET - used by all token generation and verification
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const AUTH_SECRET = process.env.AUTH_SECRET;
const SECRET_FILE = join(process.cwd(), 'db', '.auth-secret');

// Ensure the db directory exists
const DB_DIR = join(process.cwd(), 'db');
if (!existsSync(DB_DIR)) {
  try { mkdirSync(DB_DIR, { recursive: true }); } catch { /* ignore */ }
}

/**
 * Get or create a persistent fallback secret stored in db/.auth-secret.
 * This ensures the secret stays consistent across:
 * - Hot module reloads (Next.js dev mode)
 * - Server restarts
 * - Multiple concurrent requests
 * 
 * Without AUTH_SECRET env var, the file-based secret is used.
 * For production, always set AUTH_SECRET env var.
 */
function getOrCreateFallbackSecret(): string {
  try {
    if (existsSync(SECRET_FILE)) {
      const stored = readFileSync(SECRET_FILE, 'utf-8').trim();
      if (stored.length >= 16) return stored;
    }
    // Generate a strong random secret
    const secret = crypto.randomBytes(32).toString('hex');
    try {
      writeFileSync(SECRET_FILE, secret, 'utf-8');
    } catch {
      // If write fails, use the already-generated crypto-random secret (consistent within this process)
      // This is still secure because it's crypto-random and different per process
      console.warn('[Auth] Could not persist auth secret to file. Secret is valid for this process only.');
      return secret;
    }
    return secret;
  } catch {
    // Generate an in-memory crypto-random secret as absolute last resort
    // This is still secure - crypto.randomBytes produces cryptographically strong random values
    // The downside is: tokens will be invalidated on server restart
    console.error('[Auth] CRITICAL: Could not read/create auth secret file. Using in-memory secret.');
    return crypto.randomBytes(32).toString('hex');
  }
}

// Cache the resolved secret for this process lifetime
let _cachedSecret: string | null = null;

export function getAuthSecret(): string {
  if (_cachedSecret) return _cachedSecret;

  if (!AUTH_SECRET) {
    console.warn('[Auth] AUTH_SECRET env var not set. Using file-based fallback secret. Set AUTH_SECRET for production.');
  }

  _cachedSecret = AUTH_SECRET || getOrCreateFallbackSecret();
  return _cachedSecret;
}
