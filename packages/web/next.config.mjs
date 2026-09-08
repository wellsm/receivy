import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("./package.json");

/** @type {import("next").NextConfig} */
const nextConfig = {
  agentRules: false,
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  async headers() {
    return [{
      source: "/pay/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    }];
  },
};

export default nextConfig;
