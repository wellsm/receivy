import type { Bucket } from "@ez4/storage";
/** Private per-stage bucket. Retained proofs must NOT use bucket-wide autoExpireDays. */
export declare class ProofFiles extends Bucket.Service {
  cors: Bucket.UseCors<{
    allowOrigins: ["http://localhost:3000"];
    allowMethods: ["PUT"];
    allowHeaders: ["content-type", "content-length"];
    maxAge: 300;
  }>;
}
