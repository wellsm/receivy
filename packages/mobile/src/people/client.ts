import type { Person, PersonInput, PeoplePage } from "@receivy/common";
import { authClient } from "@/auth/client";

async function request(path: string, init: RequestInit = {}) {
  const response = await authClient.authenticatedFetch(path, init);
  if (!response.ok) throw new Error(response.status === 409
    ? "Já existe um contato ativo com esse e-mail." : "Não foi possível acessar seus contatos. Tente novamente.");
  return response;
}
export const peopleClient = {
  async list(archived = false, cursor?: string, search?: string): Promise<PeoplePage> {
    const params = new URLSearchParams({ archived: String(archived), ...(cursor ? { cursor } : {}), ...(search ? { search } : {}) });
    return (await request(`people?${params}`)).json();
  },
  async save(input: PersonInput, id?: string): Promise<Person> {
    return (await request(id ? `people/${id}` : "people", { method: id ? "PATCH" : "POST", body: JSON.stringify(input) })).json();
  },
  async archive(id: string): Promise<void> { await request(`people/${id}/archive`, { method: "POST" }); },
};
