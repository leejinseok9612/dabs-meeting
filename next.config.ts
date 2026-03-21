import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp를 서버 사이드에서만 사용 (클라이언트 번들 제외)
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
