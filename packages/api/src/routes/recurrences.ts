import type { Http } from "@ez4/gateway";
import type { sessionAuthorizer } from "../authorizers/session";
import type { createRecurrenceHandler, editRecurrenceHandler, getRecurrenceHandler, listRecurrencesHandler, pauseRecurrenceHandler, reactivateRecurrenceHandler, endRecurrenceHandler } from "../recurrences/endpoints";
export type RecurrenceRoutes = [
  Http.UseRoute<{ name: "createRecurrence"; path: "POST /recurrences"; authorizer: typeof sessionAuthorizer; handler: typeof createRecurrenceHandler }>,
  Http.UseRoute<{ name: "listRecurrences"; path: "GET /recurrences"; authorizer: typeof sessionAuthorizer; handler: typeof listRecurrencesHandler }>,
  Http.UseRoute<{ name: "getRecurrence"; path: "GET /recurrences/{id}"; authorizer: typeof sessionAuthorizer; handler: typeof getRecurrenceHandler }>,
  Http.UseRoute<{ name: "previewRecurrence"; path: "GET /recurrences/{id}/preview"; authorizer: typeof sessionAuthorizer; handler: typeof getRecurrenceHandler }>,
  Http.UseRoute<{ name: "editRecurrence"; path: "PATCH /recurrences/{id}"; authorizer: typeof sessionAuthorizer; handler: typeof editRecurrenceHandler }>,
  Http.UseRoute<{ name: "pauseRecurrence"; path: "POST /recurrences/{id}/pause"; authorizer: typeof sessionAuthorizer; handler: typeof pauseRecurrenceHandler }>,
  Http.UseRoute<{ name: "reactivateRecurrence"; path: "POST /recurrences/{id}/reactivate"; authorizer: typeof sessionAuthorizer; handler: typeof reactivateRecurrenceHandler }>,
  Http.UseRoute<{ name: "endRecurrence"; path: "POST /recurrences/{id}/end"; authorizer: typeof sessionAuthorizer; handler: typeof endRecurrenceHandler }>,
];
