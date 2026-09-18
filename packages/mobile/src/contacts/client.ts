import type { Contact, ContactInput, ContactsPage } from "@receivy/common";
import { authClient } from "@/auth/client";

/**
 * Carries the status so a screen can tell apart the conflicts this API raises.
 * The endpoint answers `409` for a duplicate e-mail, for an edit that touches
 * more than the nickname of an active contact and for an e-mail that already
 * belongs to another account, and the envelope only ships stable codes
 * (`CONFLICT` for all), never the backend's own text — see `apiErrorMessage`.
 * Only the screen knows which one it just provoked.
 */
export class ContactsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ContactsRequestError";
  }
}

const CONFLICT_ERROR = "Já existe um contato com esse e-mail.";
const REQUEST_ERROR = "Não foi possível acessar seus contatos. Tente novamente.";

async function request(path: string, init: RequestInit = {}) {
  const response = await authClient.authenticatedFetch(path, init);

  if (!response.ok) {
    throw new ContactsRequestError(response.status === 409 ? CONFLICT_ERROR : REQUEST_ERROR, response.status);
  }

  return response;
}

export const contactsClient = {
  async list(archived = false, cursor?: string, search?: string, sort?: "recent"): Promise<ContactsPage> {
    const params = new URLSearchParams({ archived: String(archived), ...(cursor ? { cursor } : {}), ...(search ? { search } : {}), ...(sort ? { sort } : {}) });

    return (await request(`contacts?${params}`)).json();
  },
  async get(id: string): Promise<Contact> {
    return (await request(`contacts/${id}`)).json();
  },
  async save(input: ContactInput, id?: string): Promise<Contact> {
    return (await request(id ? `contacts/${id}` : "contacts", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) })).json();
  },
  async archive(id: string): Promise<void> { await request(`contacts/${id}/archive`, { method: "POST" }); },
};
