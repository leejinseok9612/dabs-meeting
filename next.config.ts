import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp를 서버 사이드에서만 사용 (클라이언트 번들 제외)
  serverExternalPackages: ["sharp"],
  // 예전 URL → / 로 리다이렉트 (단일 페이지 앱 전환)
  async redirects() {
    return [
      { source: '/dashboard', destination: '/', permanent: false },
      { source: '/dashboard/:path*', destination: '/', permanent: false },
      { source: '/submit/:path*', destination: '/', permanent: false },
    ]
  },
};

export default nextConfig;
