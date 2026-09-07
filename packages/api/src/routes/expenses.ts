import type { Http } from "@ez4/gateway";
import type { sessionAuthorizer } from "../authorizers/session";
import type { createExpenseHandler, getExpenseHandler } from "../expenses/endpoints";

export type ExpenseRoutes = [
  Http.UseRoute<{ name: "createExpense"; path: "POST /expenses"; authorizer: typeof sessionAuthorizer; handler: typeof createExpenseHandler }>,
  Http.UseRoute<{ name: "getExpense"; path: "GET /expenses/{id}"; authorizer: typeof sessionAuthorizer; handler: typeof getExpenseHandler }>,
];
