import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type {
  downloadProofHandler,
  finalizeProofHandler,
  listProofsHandler,
  publicFinalizeProofHandler,
  publicProofStatusHandler,
  publicUploadProofHandler,
  reviewProofHandler,
  uploadProofHandler
} from '../proofs/endpoints';
export type ProofRoutes = [
  Http.UseRoute<{
    name: 'publicProofStatus';
    path: 'GET /public/charges/{token}/proofs/uploads/{intentId}';
    handler: typeof publicProofStatusHandler;
  }>,
  Http.UseRoute<{
    name: 'uploadProof';
    path: 'POST /charges/{id}/proofs/uploads';
    authorizer: typeof sessionAuthorizer;
    handler: typeof uploadProofHandler;
  }>,
  Http.UseRoute<{
    name: 'finalizeProof';
    path: 'POST /charges/{id}/proofs/uploads/{intentId}/finalize';
    authorizer: typeof sessionAuthorizer;
    handler: typeof finalizeProofHandler;
  }>,
  Http.UseRoute<{
    name: 'listProofs';
    path: 'GET /charges/{id}/proofs';
    authorizer: typeof sessionAuthorizer;
    handler: typeof listProofsHandler;
  }>,
  Http.UseRoute<{
    name: 'reviewProof';
    path: 'POST /charges/{id}/proofs/{proofId}/review';
    authorizer: typeof sessionAuthorizer;
    handler: typeof reviewProofHandler;
  }>,
  Http.UseRoute<{
    name: 'downloadProof';
    path: 'POST /charges/{id}/proofs/{proofId}/download';
    authorizer: typeof sessionAuthorizer;
    handler: typeof downloadProofHandler;
  }>,
  Http.UseRoute<{
    name: 'publicUploadProof';
    path: 'POST /public/charges/{token}/proofs/uploads';
    handler: typeof publicUploadProofHandler;
  }>,
  Http.UseRoute<{
    name: 'publicFinalizeProof';
    path: 'POST /public/charges/{token}/proofs/uploads/{intentId}/finalize';
    handler: typeof publicFinalizeProofHandler;
  }>
];
