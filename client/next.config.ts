import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Next.js app lives in an npm workspace. Trace dependencies from the repo root.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  // Browsers use a SAME-ORIGIN /api path, so HttpOnly cookies work without CORS.
  // In Docker production API_PROXY_TARGET is http://api:3001 and is baked into the build.
  async rewrites() {
    const apiOrigin = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";
    const url = new URL(apiOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('API_PROXY_TARGET must be a plain http(s) origin (e.g. http://api:3001)');
    }
    return [{ source: "/api/:path*", destination: `${url.origin}/api/:path*` }];
  },
};

export default nextConfig;
