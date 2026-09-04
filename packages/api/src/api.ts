import type { Http } from "@ez4/gateway";
import type { NamingStyle } from "@ez4/schema";
import type { HealthRoutes } from "./routes/health";

/** Receivy HTTP API. */
export declare class Api extends Http.Service {
  name: "Receivy API";

  defaults: Http.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.CamelCase;
    };
  }>;

  routes: [...HealthRoutes];

  cors: Http.UseCors<{
    allowOrigins: ["http://localhost:3000"];
    allowMethods: ["GET", "POST", "PATCH", "DELETE"];
    allowHeaders: ["content-type", "authorization", "idempotency-key"];
    allowCredentials: true;
  }>;
}
