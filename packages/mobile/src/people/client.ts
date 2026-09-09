import type { Person, PersonInput, PeoplePage } from "@receivy/common";
import { authClient } from "@/auth/client";

/**
 * Carries the status so a screen can tell apart the two conflicts this API
 * raises. The endpoint answers `409` both for a duplicate e-mail and for an edit
 * that touches more than the nickname of a linked contact, and the envelope only
 * ships stable codes (`CONFLICT` for both), never the backend's own text — see
 * `apiErrorMessage`. Only the screen knows which one it just provoked.
 */
export class PeopleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PeopleRequestError";
  }
}

const CONFLICT_ERROR = "Já existe um contato ativo com esse e-mail.";
const REQUEST_ERROR = "Não foi possível acessar seus contatos. Tente novamente.";

async function request(path: string, init: RequestInit = {}) {
  const response = await authClient.authenticatedFetch(path, init);

  if (!response.ok) {
    throw new PeopleRequestError(response.status === 409 ? CONFLICT_ERROR : REQUEST_ERROR, response.status);
  }

  return response;
}
export const peopleClient = {
  async list(archived = false, cursor?: string, search?: string, sort?: "recent"): Promise<PeoplePage> {
    const params = new URLSearchParams({ archived: String(archived), ...(cursor ? { cursor } : {}), ...(search ? { search } : {}), ...(sort ? { sort } : {}) });
    return (await request(`people?${params}`)).json();
  },
  async get(id: string): Promise<Person> {
    return (await request(`people/${id}`)).json();
  },
  async save(input: PersonInput, id?: string): Promise<Person> {
    return (await request(id ? `people/${id}` : "people", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) })).json();
  },
  async archive(id: string): Promise<void> { await request(`people/${id}/archive`, { method: "POST" }); },
};
