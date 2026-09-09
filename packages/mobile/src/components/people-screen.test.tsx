import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PeopleScreen } from "./people-screen";

describe("PeopleScreen", () => {
  it("searches the server agenda and displays account linkage", async () => {
    const client = { list: jest.fn().mockImplementation(async (_archived, _cursor, search) => ({ people: search === "Ana" ? [{ id: "ana", name: "Ana", hasAccount: true, email: null, phone: null, archivedAt: null, createdAt: "2026-09-01" }] : [], nextCursor: null })), save: jest.fn(), archive: jest.fn() };
    await render(<PeopleScreen client={client} />);
    await fireEvent.changeText(screen.getByLabelText("Buscar contatos"), "Ana");
    expect(await screen.findByText("Com conta")).toBeTruthy();
  });
  it("saves a contact without requiring email or phone", async () => {
    const client = { list: jest.fn().mockResolvedValue({ people: [], nextCursor: null }), save: jest.fn().mockResolvedValue({}), archive: jest.fn() };
    await render(<PeopleScreen client={client} />);
    await fireEvent.changeText(screen.getByLabelText("Nome"), "  Ana  ");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana" }, undefined));
    expect(await screen.findByText("Contato salvo.")).toBeTruthy();
  });
});
