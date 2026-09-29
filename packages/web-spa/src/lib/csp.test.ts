import { bucketOrigin, buildContentSecurityPolicy, missingBucketOrigins } from "@/lib/csp";

const API = "https://abc123.execute-api.sa-east-1.amazonaws.com/dev-receivy-api";

describe("buildContentSecurityPolicy", () => {
  it("allows the API origin, S3 and Stripe in connect-src, without the stage path", () => {
    const policy = buildContentSecurityPolicy(API);

    expect(policy).toContain(
      "connect-src 'self' https://abc123.execute-api.sa-east-1.amazonaws.com https://*.s3.sa-east-1.amazonaws.com https://api.stripe.com",
    );
    expect(policy).not.toContain("dev-receivy-api");
  });

  it("keeps everything else on self, Stripe or nothing", () => {
    const policy = buildContentSecurityPolicy(API);

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' https://js.stripe.com https://*.js.stripe.com;");
    expect(policy).toContain("frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com");
    expect(policy).toContain("img-src 'self' data: blob: https://*.s3.sa-east-1.amazonaws.com");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("object-src 'none'");
  });

  it("omits frame-ancestors, which browsers ignore in a meta tag", () => {
    expect(buildContentSecurityPolicy(API)).not.toContain("frame-ancestors");
  });

  it("adds the local proof upload origin to connect-src", () => {
    const policy = buildContentSecurityPolicy("http://127.0.0.1:3735/local-receivy-api", "http://localhost:3735");

    expect(policy).toContain("https://api.stripe.com http://localhost:3735;");
  });

  it("does not repeat an origin that is already there", () => {
    const policy = buildContentSecurityPolicy("http://localhost:3735/x", "http://localhost:3735");

    expect(policy.match(/http:\/\/localhost:3735/g)).toHaveLength(1);
  });

  it("ignores an empty or missing proof upload origin", () => {
    expect(buildContentSecurityPolicy(API, "")).toBe(buildContentSecurityPolicy(API));
    expect(buildContentSecurityPolicy(API, null)).toBe(buildContentSecurityPolicy(API));
  });

  it("throws on an invalid API URL", () => {
    expect(() => buildContentSecurityPolicy("not a url")).toThrow();
  });

  it("lists only the two bucket origins when both are set", () => {
    const proof = "https://receivy-proof-files.s3.sa-east-1.amazonaws.com";
    const avatar = "https://receivy-avatar-files.s3.sa-east-1.amazonaws.com";
    const policy = buildContentSecurityPolicy(API, proof, avatar);

    expect(policy).not.toContain("*.s3.sa-east-1.amazonaws.com");
    expect(policy).toContain(`connect-src 'self' https://abc123.execute-api.sa-east-1.amazonaws.com ${proof} ${avatar} https://api.stripe.com;`);
    expect(policy).toContain(`frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com ${proof} ${avatar};`);
    expect(policy).toContain(`img-src 'self' data: blob: ${proof} ${avatar};`);
  });

  it("keeps the regional wildcard when either bucket origin is missing", () => {
    const proof = "https://receivy-proof-files.s3.sa-east-1.amazonaws.com";

    expect(buildContentSecurityPolicy(API, proof)).toContain("img-src 'self' data: blob: https://*.s3.sa-east-1.amazonaws.com;");
    expect(buildContentSecurityPolicy(API, null, "https://receivy-avatar-files.s3.sa-east-1.amazonaws.com")).toContain(
      "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.s3.sa-east-1.amazonaws.com;",
    );
  });

  it("names the bucket variables that are missing", () => {
    expect(missingBucketOrigins("https://a.test", "https://b.test")).toEqual([]);
    expect(missingBucketOrigins("https://a.test", "")).toEqual(["VITE_AVATAR_ORIGIN"]);
    expect(missingBucketOrigins(undefined, " ")).toEqual(["VITE_PROOF_UPLOAD_ORIGIN", "VITE_AVATAR_ORIGIN"]);
  });

  it("accepts an https origin, or http on localhost and 127.0.0.1", () => {
    expect(bucketOrigin("VITE_AVATAR_ORIGIN", "https://bucket.s3.sa-east-1.amazonaws.com/")).toBe("https://bucket.s3.sa-east-1.amazonaws.com");
    expect(bucketOrigin("VITE_AVATAR_ORIGIN", "http://localhost:3735")).toBe("http://localhost:3735");
    expect(bucketOrigin("VITE_AVATAR_ORIGIN", "http://127.0.0.1:3735")).toBe("http://127.0.0.1:3735");
    expect(bucketOrigin("VITE_AVATAR_ORIGIN", "")).toBeNull();
    expect(bucketOrigin("VITE_AVATAR_ORIGIN", undefined)).toBeNull();
  });

  it.each([
    "http://bucket.example.com",
    "ftp://bucket.example.com",
    "https://bucket.example.com/path",
    "https://bucket.example.com?x=1",
    "https://bucket.example.com#frag",
    "https://user:pass@bucket.example.com",
    "not a url",
  ])("rejects %s as a bucket origin", (value) => {
    expect(() => bucketOrigin("VITE_AVATAR_ORIGIN", value)).toThrow("VITE_AVATAR_ORIGIN");
    expect(() => buildContentSecurityPolicy(API, value, "https://b.test")).toThrow("VITE_PROOF_UPLOAD_ORIGIN");
  });
});
