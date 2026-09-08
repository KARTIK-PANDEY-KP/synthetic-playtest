import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The dashboard talks to the orchestrator directly (NEXT_PUBLIC_ORCHESTRATOR_URL,
// default http://localhost:4000). If that service ever lacks CORS headers, set
// NEXT_PUBLIC_ORCHESTRATOR_URL="" and ORCHESTRATOR_URL=http://localhost:4000 so
// /api/* is proxied through Next instead (the WS then falls back to polling).
const upstream = process.env.ORCHESTRATOR_URL;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // repo path contains a space — resolve via fileURLToPath, never URL.pathname
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  async rewrites() {
    if (!upstream) return [];
    return [{ source: "/api/:path*", destination: `${upstream}/api/:path*` }];
  },
};

export default nextConfig;
