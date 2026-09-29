/**
 * API Gateway of the prd stage. The owner replaces the placeholder with the host printed by
 * `cd packages/api && APP_STAGE=prd ez4 output -e prd.env`; `location` is the API stage path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "REPLACE-WITH-API-ID.execute-api.sa-east-1.amazonaws.com";
export type ApiLocation = "/prd-receivy-api";

/**
 * CNAMEs of the prd distribution. The owner replaces the placeholder with the production web domain, sets the same
 * value in `WebCertificateDomain` and enables the `certificate` line in `distribution.ts` before deploying prd.
 */
export type WebAliases = ["REPLACE-WITH-PRD-WEB-DOMAIN"];
/** Domain of the prd certificate (EZ4 requests it in ACM). */
export type WebCertificateDomain = "REPLACE-WITH-PRD-WEB-DOMAIN";
