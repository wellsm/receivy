import type { Http } from "@ez4/gateway";
import type { sessionAuthorizer } from "../authorizers/session";
import type { getPersonHandler, listPeopleHandler, createPersonHandler, updatePersonHandler, archivePersonHandler } from "../people/endpoints";

export type PeopleRoutes = [
  Http.UseRoute<{ name: "getPerson"; path: "GET /people/{id}"; authorizer: typeof sessionAuthorizer; handler: typeof getPersonHandler }>,
  Http.UseRoute<{ name: "listPeople"; path: "GET /people"; authorizer: typeof sessionAuthorizer; handler: typeof listPeopleHandler }>,
  Http.UseRoute<{ name: "createPerson"; path: "POST /people"; authorizer: typeof sessionAuthorizer; handler: typeof createPersonHandler }>,
  Http.UseRoute<{ name: "updatePerson"; path: "PATCH /people/{id}"; authorizer: typeof sessionAuthorizer; handler: typeof updatePersonHandler }>,
  Http.UseRoute<{ name: "archivePerson"; path: "POST /people/{id}/archive"; authorizer: typeof sessionAuthorizer; handler: typeof archivePersonHandler }>,
];
