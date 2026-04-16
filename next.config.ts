import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // Tree-shake heavy libraries to reduce bundle size
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      '@tanstack/react-table',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      'framer-motion',
    ],
  },

  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // Disable source maps in dev to save memory
      config.devtool = false;
      // Limit parallel compilation
      config.parallelism = 1;
    }

    if (isServer) {
      if (!config.externals) config.externals = [];
      if (Array.isArray(config.externals)) {
        config.externals.push('sharp', 'pg-native');
      }
    }

    return config;
  },

  allowedDevOrigins: [
    "https://*.space.z.ai",
    "http://*.space.z.ai",
    "https://space.z.ai",
    "http://space.z.ai",
    "https://z.ai",
    "http://z.ai",
  ],
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/api/pwa/icon?size=32' }];
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default nextConfig;
