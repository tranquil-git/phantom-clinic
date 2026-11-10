// Trình duyệt chỉ gọi /api/* cùng origin; Next.js chuyển tiếp sang API Node.js (backend/)
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
