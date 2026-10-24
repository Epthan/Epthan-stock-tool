import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown in the app (logo tooltip, Data history) so you can tell which version is running.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
