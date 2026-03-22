import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/oauth/:path*', destination: `${apiUrl}/oauth/:path*` },
      { source: '/.well-known/:path*', destination: `${apiUrl}/.well-known/:path*` },
    ];
  },
};

export default nextConfig;
