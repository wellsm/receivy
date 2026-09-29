/**
 * API Gateway of the dev stage. The owner replaces the placeholder with the host printed by
 * `pnpm --filter @receivy/api output:dev`; `location` is the API stage path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "REPLACE-WITH-API-ID.execute-api.sa-east-1.amazonaws.com";
export type ApiLocation = "/dev-receivy-api";

/**
 * CNAMEs of the dev distribution. Empty for the first deploy: the stage answers on its `*.cloudfront.net` host
 * (`pnpm --filter @receivy/web-spa output:dev`). The owner sets `["<dev domain>"]` together with
 * `WebCertificateDomain` and the `certificate` line in `distribution.ts`, then redeploys.
 */
export type WebAliases = [];
/** Domain of the dev certificate (EZ4 requests it in ACM); used once the `certificate` line is enabled. */
export type WebCertificateDomain = "REPLACE-WITH-DEV-WEB-DOMAIN";
