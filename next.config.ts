import type { NextConfig } from "next";

const distDir = process.env.GREENLENS_E2E_BUILD === "1"
  ? ".next-playwright"
  : process.env.NODE_ENV === "production"
    ? ".next-production-light"
    : ".next-dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A fresh, never-used build dir avoids ENOTEMPTY when `next build` tries to
  // clean a stale dir locked by lingering Windows handles.
  distDir,
  // Limit static-generation workers: the default (os.cpus() = 15) spawns ~15
  // workers at ~440MB each and OOMs this machine during `next build`.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
