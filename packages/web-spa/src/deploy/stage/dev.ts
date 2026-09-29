/**
 * API Gateway of the dev stage. The owner replaces the placeholder with the host printed by
 * `pnpm --filter @receivy/api output:dev`, without `https://` and without a path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "f6whczszrf.execute-api.sa-east-1.amazonaws.com";

/**
 * CNAMEs of the dev distribution. The distribution also keeps answering on its `*.cloudfront.net` host, which is
 * where the DNS record of the domain points (`pnpm --filter @receivy/web-spa output:dev` prints it).
 */
export type WebAliases = ["receivy.wellsm.dev"];
/**
 * Domain of the dev certificate. CloudFront only accepts certificates from us-east-1, and the vendored
 * `@ez4/aws-certificate` requests it there whatever the region of the deploy: `AWS_REGION` stays `sa-east-1`.
 */
export type WebCertificateDomain = "receivy.wellsm.dev";
