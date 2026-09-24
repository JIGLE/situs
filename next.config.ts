import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/config.ts");

const nextConfig: NextConfig = {
  compress: true,
  output: "standalone",
  serverExternalPackages: ["redis", "puppeteer"],
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-slot", "framer-motion"],
    // Behind the proxy, Next buffers a request body only up to this size and drops the rest,
    // silently: an upload past it arrives cut short rather than refused. The default is 10 MB,
    // and a scanned contract can be larger, so this sits above the 20 MB the contract route
    // accepts (app/api/leases/[id]/contract).
    proxyClientMaxBodySize: "25mb",
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // Configure turbopack with explicit root to avoid lockfile detection issues
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: [
          // CSP is handled dynamically by proxy.ts (with nonces for scripts)
          // Only set non-CSP security headers here as fallback
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
