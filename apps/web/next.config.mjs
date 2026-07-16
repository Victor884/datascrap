import path from 'path';

const apiInternalBase = process.env.API_INTERNAL_BASE ?? 'http://127.0.0.1:5000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
