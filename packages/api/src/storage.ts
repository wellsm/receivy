import type { Environment } from '@ez4/common';
import type { Bucket } from '@ez4/storage';
import type { Db } from './database';
import type { proofObjectEvent } from './proofs/events/receive-object';

/**
 * Private per-stage bucket. Retained proofs must NOT use bucket-wide autoExpireDays. Browser uploads go
 * straight to the bucket with a signed PUT, so every web origin that serves the proof panel must be
 * listed here (EZ4 CORS is declared statically). The `proofs/*` event is how the API learns a file
 * landed: there is no finalize call from the client.
 */
export declare class ProofFiles extends Bucket.Service {
  cors: Bucket.UseCors<{
    allowOrigins: ['http://localhost:3000', 'https://receivy.wellsm.dev'];
    allowMethods: ['PUT'];
    allowHeaders: ['content-type', 'content-length'];
    maxAge: 300;
  }>;

  events: [
    Bucket.UseEvent<{
      path: 'proofs/*';
      handler: typeof proofObjectEvent;
    }>
  ];

  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
  };
}
