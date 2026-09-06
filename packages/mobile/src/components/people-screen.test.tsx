import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PeopleScreen } from "./people-screen";

describe("PeopleScreen", () => {
  it("saves a contact without requiring email or phone", async () => {
    const client = { list: jest.fn().mockResolvedValue({ people: [], nextCursor: null }), save: jest.fn().mockResolvedValue({}), archive: jest.fn() };
    await render(<PeopleScreen client={client} onBack={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText("Nome"), "  Ana  ");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana" }, undefined));
    expect(await screen.findByText("Contato salvo.")).toBeTruthy();
  });
});
