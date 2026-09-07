import type { Http } from "@ez4/gateway";
import type { NamingStyle } from "@ez4/schema";
import type { HealthRoutes } from "./routes/health";
import type { AuthRoutes } from "./routes/auth";
import type { PeopleRoutes } from "./routes/people";
import type { PaymentMethodRoutes } from "./routes/payment-methods";
import type { ExpenseRoutes } from "./routes/expenses";
import type { ChargeRoutes } from "./routes/charges";
import type { PublicRoutes } from "./routes/public";
import type { TimelineRoutes } from "./routes/timeline";
import type { ProofRoutes } from "./routes/proofs";
import type { RecurrenceRoutes } from "./routes/recurrences";
import type { NotificationRoutes } from "./routes/notifications";

/** Receivy HTTP API. */
export declare class Api extends Http.Service {
  name: "Receivy API";

  defaults: Http.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.CamelCase;
    };
  }>;

  routes: [
    ...HealthRoutes,
    ...AuthRoutes,
    ...PeopleRoutes,
    ...PaymentMethodRoutes,
    ...ExpenseRoutes,
    ...ChargeRoutes,
    ...PublicRoutes,
    ...TimelineRoutes,
    ...ProofRoutes,
    ...RecurrenceRoutes,
    ...NotificationRoutes,
  ];

  cors: Http.UseCors<{
    allowOrigins: ["http://localhost:3000"];
    allowMethods: ["GET", "POST", "PATCH", "DELETE"];
    allowHeaders: ["content-type", "authorization", "idempotency-key"];
    allowCredentials: true;
  }>;
}
