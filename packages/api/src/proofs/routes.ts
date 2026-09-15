import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { completeProofUploadHandler } from './endpoints/complete-upload';
import type { declarePaymentHandler } from './endpoints/declare';
import type { downloadProofHandler } from './endpoints/download';
import type { publicCompleteProofUploadHandler } from './endpoints/public-complete-upload';
import type { publicDeclarePaymentHandler } from './endpoints/public-declare';
import type { publicStartProofUploadHandler } from './endpoints/public-start-upload';
import type { publicProofStateHandler } from './endpoints/public-state';
import type { publicWithdrawProofHandler } from './endpoints/public-withdraw';
import type { reviewProofHandler } from './endpoints/review';
import type { startProofUploadHandler } from './endpoints/start-upload';
import type { withdrawProofHandler } from './endpoints/withdraw';

export type ProofRoutes = [
  Http.UseRoute<{
    name: 'startProofUpload';
    path: 'POST /charges/{id}/proof';
    authorizer: typeof sessionAuthorizer;
    handler: typeof startProofUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'completeProofUpload';
    path: 'POST /charges/{id}/proof/complete';
    authorizer: typeof sessionAuthorizer;
    handler: typeof completeProofUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'withdrawProof';
    path: 'DELETE /charges/{id}/proof';
    authorizer: typeof sessionAuthorizer;
    handler: typeof withdrawProofHandler;
  }>,
  Http.UseRoute<{
    name: 'reviewProof';
    path: 'POST /charges/{id}/proof/review';
    authorizer: typeof sessionAuthorizer;
    handler: typeof reviewProofHandler;
  }>,
  Http.UseRoute<{
    name: 'downloadProof';
    path: 'GET /charges/{id}/proof/download';
    authorizer: typeof sessionAuthorizer;
    handler: typeof downloadProofHandler;
  }>,
  Http.UseRoute<{
    name: 'publicStartProofUpload';
    path: 'POST /public/charges/{token}/proof';
    handler: typeof publicStartProofUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'publicCompleteProofUpload';
    path: 'POST /public/charges/{token}/proof/complete';
    handler: typeof publicCompleteProofUploadHandler;
  }>,
  Http.UseRoute<{ name: 'publicProofState'; path: 'GET /public/charges/{token}/proof'; handler: typeof publicProofStateHandler }>,
  Http.UseRoute<{ name: 'publicWithdrawProof'; path: 'DELETE /public/charges/{token}/proof'; handler: typeof publicWithdrawProofHandler }>,
  Http.UseRoute<{
    name: 'declarePayment';
    path: 'POST /charges/{id}/proof/declaration';
    authorizer: typeof sessionAuthorizer;
    handler: typeof declarePaymentHandler;
  }>,
  Http.UseRoute<{
    name: 'publicDeclarePayment';
    path: 'POST /public/charges/{token}/proof/declaration';
    handler: typeof publicDeclarePaymentHandler;
  }>
];
