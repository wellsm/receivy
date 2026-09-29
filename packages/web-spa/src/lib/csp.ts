const S3 = "https://*.s3.sa-east-1.amazonaws.com";

/**
 * Production CSP for the meta tag injected at build time. Only the API origin and, for local uploads,
 * the proof upload origin vary. Throws on an invalid URL. `frame-ancestors` is left out: browsers ignore
 * it in a meta tag, so the host has to send it as a header.
 */
export function buildContentSecurityPolicy(apiUrl: string, proofUploadOrigin?: string | null): string {
  const connect = ["'self'", new URL(apiUrl).origin, S3, "https://api.stripe.com"];
  const upload = proofUploadOrigin?.trim() ? new URL(proofUploadOrigin.trim()).origin : null;

  if (upload && !connect.includes(upload)) {
    connect.push(upload);
  }

  return [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com",
    `connect-src ${connect.join(" ")}`,
    // S3 also serves the PDF proof shown in the owner's viewer iframe.
    `frame-src https://js.stripe.com https://hooks.stripe.com ${S3}`,
    `img-src 'self' data: blob: ${S3}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
