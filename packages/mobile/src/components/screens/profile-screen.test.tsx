import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ACCOUNT_DELETED } from "@receivy/common";
import { ProfileScreen } from "@/components/screens/profile-screen";

jest.mock("@/navigation/tab-header", () => ({ useTabHeader: () => {} }));

const user = {
  id: "u1",
  email: "lucas@email.com",
  name: "Lucas Silveira",
  phone: null,
  avatarUrl: null,
  status: "active",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  country: "BR",
  currency: "BRL",
} as const;

function client(overrides: Partial<Record<"profile" | "save" | "logout" | "erase", jest.Mock>> = {}) {
  return {
    profile: jest.fn().mockResolvedValue(user),
    save: jest.fn().mockResolvedValue(user),
    logout: jest.fn().mockResolvedValue(undefined),
    erase: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const store = { remember: jest.fn() };

describe("ProfileScreen", () => {
  it("shows identity, edits the name inline and remembers it", async () => {
    const save = jest.fn().mockResolvedValue({ ...user, name: "Lucas S." });
    const remember = jest.fn();

    await render(<ProfileScreen client={client({ save })} store={{ remember }} version="1.0.0" />);

    expect(await screen.findByText("Lucas Silveira")).toBeOnTheScreen();
    expect(screen.getByText("L")).toBeOnTheScreen();
    expect(screen.getByText("lucas@email.com")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Editar nome"));
    await fireEvent.changeText(screen.getByLabelText("Nome"), "Lucas S.");
    await fireEvent.press(screen.getByLabelText("Salvar nome"));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Lucas S.", locale: "pt-BR", country: "BR" })),
    );
    expect(remember).toHaveBeenCalled();
    expect(await screen.findByText("Lucas S.")).toBeOnTheScreen();
  });

  it("navigates to contacts and pix keys", async () => {
    const onOpenContacts = jest.fn();
    const onOpenPix = jest.fn();

    await render(
      <ProfileScreen
        client={client()}
        store={store}
        version="1.0.0"
        onOpenContacts={onOpenContacts}
        onOpenPix={onOpenPix}
      />,
    );

    expect(await screen.findByText("Meus Contatos")).toBeOnTheScreen();
    expect(screen.getByText("Gerenciar pessoas e dados salvos de cobrança")).toBeOnTheScreen();
    expect(screen.getByText("Minhas Chaves Pix")).toBeOnTheScreen();
    expect(screen.getByText("Chaves cadastradas para receber pagamentos")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Gerenciar contatos"));
    expect(onOpenContacts).toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Gerenciar chaves Pix"));
    expect(onOpenPix).toHaveBeenCalled();
  });

  it("logs out only after confirming", async () => {
    const onLoggedOut = jest.fn();
    const api = client();

    await render(<ProfileScreen client={api} store={store} version="1.0.0" onLoggedOut={onLoggedOut} />);

    await fireEvent.press(await screen.findByLabelText("Sair da conta"));
    expect(screen.getByText("Deseja sair da sua conta?")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Cancelar"));
    expect(api.logout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Sair da conta"));
    await fireEvent.press(screen.getByLabelText("Sair"));

    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(onLoggedOut).toHaveBeenCalled();
  });

  it("deletes the account only with the literal confirmation", async () => {
    const onLoggedOut = jest.fn();
    const api = client();

    await render(<ProfileScreen client={api} store={store} version="1.0.0" onLoggedOut={onLoggedOut} />);

    await fireEvent.press(await screen.findByLabelText("Excluir conta"));
    expect(screen.getByText("Excluir conta?")).toBeOnTheScreen();
    expect(screen.getByLabelText("Confirmar exclusão")).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await fireEvent.press(screen.getByLabelText("Confirmar exclusão"));

    await waitFor(() => expect(api.erase).toHaveBeenCalled());
    expect(await screen.findByText(ACCOUNT_DELETED)).toBeOnTheScreen();
    expect(onLoggedOut).toHaveBeenCalled();
  });

  it("pins the dark theme from Aparência and stores it on the device", async () => {
    const { Uniwind } = jest.requireMock("uniwind") as { Uniwind: { setTheme: jest.Mock } };
    const SecureStore = jest.requireMock("expo-secure-store") as { setItem: jest.Mock };

    await render(<ProfileScreen client={client()} store={store} version="1.0.0" />);
    await screen.findByText("Lucas Silveira");

    expect(screen.getByRole("radio", { name: "Sistema" })).toBeChecked();

    await fireEvent.press(screen.getByRole("radio", { name: "Escuro" }));

    expect(screen.getByRole("radio", { name: "Escuro" })).toBeChecked();
    expect(SecureStore.setItem).toHaveBeenCalledWith("receivy.theme", "dark");
    expect(Uniwind.setTheme).toHaveBeenCalledWith("dark");
  });
});
