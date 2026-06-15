import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright bundles a native Chromium binary and must not be traced/bundled
  // into the server build — keep it external so it loads from node_modules.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
