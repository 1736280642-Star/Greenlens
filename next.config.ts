import type { NextConfig } from "next";

const distDir = process.env.GREENLENS_E2E_BUILD === "1"
  ? ".next-playwright"
  : process.env.NODE_ENV === "production"
    ? ".next"
    : ".next-dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Vercel production deployments must use the standard .next directory.
  distDir,

  // Limit static-generation workers to reduce build memory usage.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
