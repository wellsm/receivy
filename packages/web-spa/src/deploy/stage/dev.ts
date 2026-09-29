/**
 * API Gateway of the dev stage. The owner replaces the placeholder with the host printed by
 * `pnpm --filter @receivy/api output:dev`; `location` is the API stage path.
 * Plain type aliases, not one object type: the EZ4 0.53 parser does not resolve indexed access types.
 */
export type ApiDomain = "REPLACE-WITH-API-ID.execute-api.sa-east-1.amazonaws.com";
export type ApiLocation = "/dev-receivy-api";
