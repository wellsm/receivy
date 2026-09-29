import type { Environment } from "@ez4/common";
import type { Cdn } from "@ez4/distribution";
import type { ApiDomain, ApiLocation } from "@stage";
import type { WebFiles } from "./storage";

/**
 * CloudFront in front of the SPA bucket. Two extra origins send the provider callbacks to the API Gateway:
 * Apple only accepts a Return URL on a verifiable domain, and the API lives on an execute-api host. CloudFront
 * keeps the request path, so the web paths are the API's own (`/auth/google/callback`, `/auth/apple/callback`).
 * Deploy-only: the app never imports this file, so Vite leaves it out of the bundle.
 */
export declare class WebCdn extends Cdn.Service {
  defaultIndex: "index.html";

  aliases: [];

  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<WebFiles>;
    rewrite: [
      // Client-side routes (/login, /pay/<token>, /auth/callback...) all serve index.html; only static files are fetched as themselves.
      Cdn.UseRewriteRule<{ from: "!*.{js|css|txt|png|svg|ico|jpg|webp|woff|woff2|map|json}"; to: "/" }>,
    ];
  }>;

  origins: [
    Cdn.UseOrigin<{
      path: "/auth/google/callback";
      domain: ApiDomain;
      location: ApiLocation;
      cache: Cdn.UseCache<{ ttl: 0; queries: ["code", "state", "error"] }>;
    }>,
    Cdn.UseOrigin<{
      path: "/auth/apple/callback";
      domain: ApiDomain;
      location: ApiLocation;
      cache: Cdn.UseCache<{ ttl: 0 }>;
    }>,
  ];

  invalidations: ["/index.html"];
}
