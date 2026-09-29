const S3 = "https://*.s3.sa-east-1.amazonaws.com";
const PROOF_ORIGIN_VARIABLE = "VITE_PROOF_UPLOAD_ORIGIN";
const AVATAR_ORIGIN_VARIABLE = "VITE_AVATAR_ORIGIN";
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

function isBlank(value?: string | null): boolean {
  return !value?.trim();
}

/**
 * A bucket origin from a build variable: `https:` (or `http:` on localhost), with no path, query, fragment or
 * credentials. Empty means not configured (null). Anything else throws, so a bad value fails the build.
 */
export function bucketOrigin(variable: string, value?: string | null): string | null {
  const raw = (value ?? "").trim();

  if (!raw) {
    return null;
  }

  const invalid = new Error(`${variable} must be a bare https origin (or http on localhost), got "${raw}".`);

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw invalid;
  }

  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname));
  const bare = url.pathname === "/" && !url.search && !url.hash && !raw.includes("?") && !raw.includes("#") && !url.username && !url.password;

  if (!secure || !bare) {
    throw invalid;
  }

  return url.origin;
}

/** The bucket variables left empty: while any is, the policy keeps the regional S3 wildcard. */
export function missingBucketOrigins(proofUploadOrigin?: string | null, avatarOrigin?: string | null): string[] {
  const missing: string[] = [];

  if (isBlank(proofUploadOrigin)) {
    missing.push(PROOF_ORIGIN_VARIABLE);
  }

  if (isBlank(avatarOrigin)) {
    missing.push(AVATAR_ORIGIN_VARIABLE);
  }

  return missing;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Production CSP for the meta tag injected at build time. The API origin and the two bucket origins (proofs and
 * avatars) vary; with both buckets set only they are allowed, otherwise the regional S3 wildcard stays. Throws on
 * an invalid URL. `frame-ancestors` is left out: browsers ignore it in a meta tag, so the host has to send it as a
 * header.
 */
export function buildContentSecurityPolicy(apiUrl: string, proofUploadOrigin?: string | null, avatarOrigin?: string | null): string {
  const proof = bucketOrigin(PROOF_ORIGIN_VARIABLE, proofUploadOrigin);
  const avatar = bucketOrigin(AVATAR_ORIGIN_VARIABLE, avatarOrigin);
  const buckets = proof && avatar ? [proof, avatar] : [S3];
  const api = new URL(apiUrl).origin;
  const connect = unique(proof && avatar ? ["'self'", api, ...buckets, "https://api.stripe.com"] : ["'self'", api, S3, "https://api.stripe.com", ...(proof ? [proof] : [])]);

  return [
    "default-src 'self'",
    // Stripe.js: https://docs.stripe.com/security/guide (Content Security Policy, Stripe.js).
    "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
    `connect-src ${connect.join(" ")}`,
    // The proof bucket also serves the PDF shown in the owner's viewer iframe.
    `frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com ${unique(buckets).join(" ")}`,
    `img-src 'self' data: blob: ${unique(buckets).join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
