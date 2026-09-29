/**
 * API Gateway of the dev stage. The owner replaces the placeholder with the host printed by
 * `pnpm --filter @receivy/api output:dev`; `location` is the API stage path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "REPLACE-WITH-API-ID.execute-api.sa-east-1.amazonaws.com";
export type ApiLocation = "/dev-receivy-api";

/**
 * CNAMEs of the dev distribution. The distribution also keeps answering on its `*.cloudfront.net` host, which is
 * where the DNS record of the domain points (`pnpm --filter @receivy/web-spa output:dev` prints it).
 */
export type WebAliases = ["receivy.wellsm.dev"];
/**
 * Domain of the dev certificate. EZ4 requests it in ACM in the region of `AWS_REGION`, and CloudFront only accepts
 * certificates from us-east-1: the web stage deploys with `AWS_REGION=us-east-1`, whatever the region of the API.
 */
export type WebCertificateDomain = "receivy.wellsm.dev";
