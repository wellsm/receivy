/** @type {import("next").NextConfig} */
const nextConfig = {
  agentRules: false,
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default nextConfig;
