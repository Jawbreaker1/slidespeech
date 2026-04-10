import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@slidespeech/types", "@slidespeech/ui"],
};

export default nextConfig;

