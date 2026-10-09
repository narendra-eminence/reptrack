import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // keep the dev badge out of E2E screenshots
  poweredByHeader: false,
};

export default nextConfig;
