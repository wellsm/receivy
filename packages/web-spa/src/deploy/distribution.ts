import type { Environment } from "@ez4/common";
import type { Cdn } from "@ez4/distribution";
import type { ApiDomain, ApiLocation, WebAliases } from "@stage";
import type { WebFiles } from "./storage";

/**
 * CloudFront in front of the SPA bucket. Two extra origins send the provider callbacks to the API Gateway:
 * Apple only accepts a Return URL on a verifiable domain, and the API lives on an execute-api host. CloudFront
 * keeps the request path, so the web paths are the API's own (`/api/auth/google/callback`, `/api/auth/apple/callback`).
 * Deploy-only: the app never imports this file, so Vite leaves it out of the bundle.
 *
 * The tag below is the label printed with the site URL after a deploy, and the distribution's comment in CloudFront.
 * It has to be a JSDoc tag: `Cdn.Service` rejects a `description` property.
 *
 * @description Receivy
 */
export declare class WebCdn extends Cdn.Service {
  defaultIndex: "index.html";

  // Per stage (src/deploy/stage/<stage>.ts). A domain alias needs a certificate: when a stage gets its first alias, add
  // `certificate: Cdn.UseCertificate<{ domain: WebCertificateDomain }>;` here (EZ4 0.53 cannot leave it out per stage).
  aliases: WebAliases;

  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<WebFiles>;
    rewrite: [
      // Client-side routes (/login, /pay/<token>, /auth/callback...) all serve index.html; only static files are fetched as themselves.
      Cdn.UseRewriteRule<{
        from: "!*.{js|css|txt|png|svg|ico|jpg|webp|woff|woff2|map|json}";
        to: "/";
      }>,
    ];
  }>;

  origins: [
    Cdn.UseOrigin<{
      path: "/api/auth/google/callback";
      domain: ApiDomain;
      location: ApiLocation;
      cache: Cdn.UseCache<{ ttl: 0; queries: ["code", "state", "error"] }>;
    }>,
    Cdn.UseOrigin<{
      path: "/api/auth/apple/callback";
      domain: ApiDomain;
      location: ApiLocation;
      cache: Cdn.UseCache<{ ttl: 0 }>;
    }>,
  ];

  // The viewer-request rewrite turns every client route into "/", which is what CloudFront caches: invalidate everything.
  invalidations: ["/*"];
}
