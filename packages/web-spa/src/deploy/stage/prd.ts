/**
 * API Gateway of the prd stage. The owner replaces the placeholder with the host printed by
 * `cd packages/api && APP_STAGE=prd ez4 output -e prd.env`, without `https://` and without a path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "l7ceaplrlh.execute-api.sa-east-1.amazonaws.com";

/**
 * CNAMEs of the prd distribution. The owner replaces the placeholder with the production web domain, sets the same
 * value in `WebCertificateDomain` and enables the `certificate` line in `distribution.ts` before deploying prd.
 */
export type WebAliases = ["receivy.app"];

/** Domain of the prd certificate (EZ4 requests it in ACM). */
export type WebCertificateDomain = "receivy.app";
