import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@identity-starter/ui'],
  async rewrites() {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
