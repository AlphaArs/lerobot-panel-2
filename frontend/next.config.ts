import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Silence workspace root detection warning when running from repo root.
    root: __dirname,
  },
};

export default nextConfig;
