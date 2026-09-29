import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { buildContentSecurityPolicy } from "./src/lib/csp";
import { providerCallbackProxy } from "./src/lib/dev-proxy";

/** Production builds only: the dev server needs inline scripts for React Fast Refresh. */
function contentSecurityPolicy(): Plugin {
  let apiUrl: string | undefined;
  let proofUploadOrigin: string | undefined;

  return {
    name: "receivy-content-security-policy",
    apply: "build",
    configResolved(config) {
      apiUrl = config.env.VITE_API_URL;
      proofUploadOrigin = config.env.VITE_PROOF_UPLOAD_ORIGIN;
    },
    transformIndexHtml() {
      if (!apiUrl) {
        throw new Error("VITE_API_URL is required to build: it goes into the CSP connect-src.");
      }

      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: buildContentSecurityPolicy(apiUrl, proofUploadOrigin) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // Must run before the React plugin: it generates the route tree and splits route components.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      generatedRouteTree: "./src/route-tree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
      // The root smoke test lives next to the route it covers; it exports no Route.
      routeFileIgnorePattern: "\\.test\\.tsx$",
    }),
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 3000,
    strictPort: true,
    // CloudFront forwards the provider callbacks to the API; the dev server does the same.
    proxy: providerCallbackProxy(loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL),
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
}));
