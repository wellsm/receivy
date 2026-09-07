import type { Bucket } from "@ez4/storage";
/** Private per-stage bucket. Retained proofs must NOT use bucket-wide autoExpireDays.
 * Browser uploads go straight to S3, so every web origin that serves the proof panel
 * must be listed here (EZ4 CORS is declared statically). Add the production origin
 * before the first production deploy; see docs/environments.md. */
export declare class ProofFiles extends Bucket.Service {
  cors: Bucket.UseCors<{
    allowOrigins: ["http://localhost:3000", "https://receivy.wellsm.dev"];
    allowMethods: ["PUT"];
    allowHeaders: ["content-type", "content-length"];
    maxAge: 300;
  }>;
}
