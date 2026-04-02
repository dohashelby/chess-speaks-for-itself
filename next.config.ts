import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/stockfish.wasm',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
    ];
  },
};

export default nextConfig;
