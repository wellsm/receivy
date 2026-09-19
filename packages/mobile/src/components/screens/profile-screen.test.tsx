import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ACCOUNT_DELETED, PlanTier, SubscriptionStatus } from "@receivy/common";
import { ProfileScreen } from "@/components/screens/profile-screen";
import { financialClient } from "@/financial/client";

jest.mock("@/navigation/tab-header", () => ({ useTabHeader: () => {} }));
jest.mock("@/account/avatar", () => ({ pickAndUploadAvatar: jest.fn(async () => ({ url: "https://bucket.test/new", version: "v2" })) }));

const user = {
  id: "u1",
  email: "lucas@email.com",
  name: "Lucas Silveira",
  phone: null,
  avatar: null,
  status: "active",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  country: "BR",
  currency: "BRL",
} as const;

function client(
  overrides: Partial<Record<"profile" | "save" | "logout" | "erase" | "startAvatarUpload" | "completeAvatarUpload", jest.Mock>> = {},
) {
  return {
    profile: jest.fn().mockResolvedValue(user),
    save: jest.fn().mockResolvedValue(user),
    logout: jest.fn().mockResolvedValue(undefined),
    erase: jest.fn().mockResolvedValue(true),
    startAvatarUpload: jest.fn(),
    completeAvatarUpload: jest.fn(),
    ...overrides,
  };
}

const store = { remember: jest.fn() };
const plans = { plan: jest.fn().mockRejectedValue(new Error("offline")) };

describe("ProfileScreen", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows identity, edits the name inline and remembers it", async () => {
    const save = jest.fn().mockResolvedValue({ ...user, name: "Lucas S." });
    const remember = jest.fn();

    await render(<ProfileScreen client={client({ save })} store={{ remember }} plans={plans} version="1.0.0" />);

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

  it("navigates to contacts and payment methods", async () => {
    const onOpenContacts = jest.fn();
    const onOpenPaymentMethods = jest.fn();

    await render(
      <ProfileScreen
        client={client()}
        store={store}
        plans={plans}
        version="1.0.0"
        onOpenContacts={onOpenContacts}
        onOpenPaymentMethods={onOpenPaymentMethods}
      />,
    );

    expect(await screen.findByText("Meus Contatos")).toBeOnTheScreen();
    expect(screen.getByText("Gerenciar pessoas e dados salvos de cobrança")).toBeOnTheScreen();
    expect(screen.getByText("Meios de pagamento")).toBeOnTheScreen();
    expect(screen.getByText("Pix e InfinitePay para receber")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Gerenciar contatos"));

    expect(onOpenContacts).toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Gerenciar meios de pagamento"));

    expect(onOpenPaymentMethods).toHaveBeenCalled();
  });

  it("logs out only after confirming", async () => {
    const onLoggedOut = jest.fn();
    const api = client();

    await render(<ProfileScreen client={api} store={store} plans={plans} version="1.0.0" onLoggedOut={onLoggedOut} />);

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

    await render(<ProfileScreen client={api} store={store} plans={plans} version="1.0.0" onLoggedOut={onLoggedOut} />);

    await fireEvent.press(await screen.findByLabelText("Excluir conta"));

    expect(screen.getByText("Excluir conta?")).toBeOnTheScreen();
    expect(screen.getByLabelText("Confirmar exclusão")).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await fireEvent.press(screen.getByLabelText("Confirmar exclusão"));

    await waitFor(() => expect(api.erase).toHaveBeenCalled());

    expect(await screen.findByText(ACCOUNT_DELETED)).toBeOnTheScreen();
    expect(onLoggedOut).toHaveBeenCalled();
  });

  it("changes the photo through the picker", async () => {
    await render(<ProfileScreen client={client()} store={store} plans={plans} version="1.0.0" />);

    await fireEvent.press(await screen.findByLabelText("Trocar foto"));

    await waitFor(() => expect(screen.getByTestId("initials-avatar-photo").props.source[0].uri).toBe("https://bucket.test/new"));
  });

  it("pins the dark theme from Aparência and stores it on the device", async () => {
    const { Uniwind } = jest.requireMock("uniwind") as { Uniwind: { setTheme: jest.Mock } };
    const SecureStore = jest.requireMock("expo-secure-store") as { setItem: jest.Mock };

    await render(<ProfileScreen client={client()} store={store} plans={plans} version="1.0.0" />);
    await screen.findByText("Lucas Silveira");

    expect(screen.getByRole("radio", { name: "Sistema" })).toBeChecked();

    await fireEvent.press(screen.getByRole("radio", { name: "Escuro" }));

    expect(screen.getByRole("radio", { name: "Escuro" })).toBeChecked();
    expect(SecureStore.setItem).toHaveBeenCalledWith("receivy.theme", "dark");
    expect(Uniwind.setTheme).toHaveBeenCalledWith("dark");
  });

  it("shows the free plan card with its usage and no purchase action", async () => {
    const plans = { plan: jest.fn().mockResolvedValue({ plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null }) };

    await render(<ProfileScreen client={client()} store={store} plans={plans} version="1.0.0" />);

    expect(await screen.findByText("Plano Grátis")).toBeTruthy();
    expect(screen.getByText("3 de 5 cobranças indefinidas")).toBeTruthy();
    expect(screen.getByText("Gerencie seu plano no site.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Assinar/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the paid plan with its renewal date", async () => {
    const plans = { plan: jest.fn().mockResolvedValue({ plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } }) };

    await render(<ProfileScreen client={client()} store={store} plans={plans} version="1.0.0" />);

    expect(await screen.findByText("Plano Básico")).toBeTruthy();
    expect(screen.getByText(/Renova em/)).toBeTruthy();
  });

  it("stays quiet when the plan cannot be read", async () => {
    const plans = { plan: jest.fn().mockRejectedValue(new Error("offline")) };

    await render(<ProfileScreen client={client()} store={store} plans={plans} version="1.0.0" />);

    expect(await screen.findByText("Meios de pagamento")).toBeTruthy();
    expect(screen.queryByText(/Plano /)).toBeNull();
  });

  it("wires the default financialClient into the plan card", async () => {
    const freeSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null };

    jest.spyOn(financialClient, "plan").mockResolvedValue(freeSummary);

    await render(<ProfileScreen client={client()} store={store} version="1.0.0" />);

    expect(await screen.findByText("Plano Grátis")).toBeTruthy();
  });
});
