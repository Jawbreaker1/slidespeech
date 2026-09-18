import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@slidespeech/types", "@slidespeech/ui"],
  // Queue wait (180s) plus question execution (120s) must fit through the proxy.
  experimental: { proxyTimeout: 330_000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.SLIDESPEECH_API_ORIGIN ?? "http://127.0.0.1:4000"}/api/:path*` }];
  },
};

export default nextConfig;
