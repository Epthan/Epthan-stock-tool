import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Test builds go to .next-test so they never clash with a running `npm run dev`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Shown in the app (logo tooltip, Data history) so you can tell which version is running.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
