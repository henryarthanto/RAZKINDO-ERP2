import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow all z.ai preview origins including HTTP (preview panel uses HTTP)
  allowedDevOrigins: [
    // Wildcard for all future sessions
    "https://*.space.z.ai",
    "http://*.space.z.ai",
    // Also add common patterns
    "https://space.z.ai",
    "http://space.z.ai",
    "https://z.ai",
    "http://z.ai",
  ],
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/api/pwa/icon?size=32',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // DO NOT set X-Frame-Options or frame-ancestors CSP —
          // the preview panel embeds this app in an iframe.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
