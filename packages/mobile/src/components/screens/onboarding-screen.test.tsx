import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { AuthUser } from "@receivy/common";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";

const user: AuthUser = {
  id: "user",
  email: "ana@example.com",
  name: null,
  phone: null,
  avatarUrl: null,
  status: "pending",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  country: "BR",
  currency: "BRL",
};

async function setup(save = jest.fn().mockResolvedValue({ ...user, name: "Ana", status: "active" }), profile: AuthUser = user) {
  const remember = jest.fn();
  const load = jest.fn().mockResolvedValue(profile);
  const onComplete = jest.fn();

  await render(<OnboardingScreen client={{ save }} store={{ load, remember }} onComplete={onComplete} />);

  return { save, remember, onComplete };
}

describe("OnboardingScreen", () => {
  it("only lets the person continue after typing a real name", async () => {
    const { save } = await setup();

    const button = screen.getByRole("button", { name: "Continuar" });
    expect(button).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Nome"), "   ");
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(save).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Nome"), "Ana");
    expect(button).toBeEnabled();
  });

  it("saves the trimmed name with the device timezone and remembers the profile", async () => {
    const { save, remember, onComplete } = await setup();

    await fireEvent.changeText(screen.getByLabelText("Nome"), "  Ana  ");
    await fireEvent.press(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({
      name: "Ana",
      locale: "pt-BR",
      country: "BR",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(remember).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana" }));
  });

  it("masks the optional phone and sends it as typed", async () => {
    const { save } = await setup();

    await fireEvent.changeText(screen.getByLabelText("Nome"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("Telefone (Opcional)"), "11987654321");

    expect(screen.getByLabelText("Telefone (Opcional)")).toHaveDisplayValue("(11) 98765-4321");

    await fireEvent.press(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana", phone: "(11) 98765-4321" })));
  });

  it("pre-fills the name an agenda already gave the account", async () => {
    await setup(undefined, { ...user, name: "Ana Paula" });

    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveDisplayValue("Ana Paula"));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("keeps the person on the screen when saving fails", async () => {
    const { onComplete } = await setup(jest.fn().mockRejectedValue(new Error("offline")));

    await fireEvent.changeText(screen.getByLabelText("Nome"), "Ana");
    await fireEvent.press(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Não foi possível salvar seu nome. Tente novamente.")).toBeOnTheScreen();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText("Como podemos chamar você?")).toBeOnTheScreen();
  });

  it("shows the legal texts only on demand", async () => {
    await setup();

    expect(screen.getAllByText("Termos de uso")).toHaveLength(1);
    await fireEvent.press(screen.getByRole("link", { name: "Termos de uso" }));
    expect(screen.getAllByText("Termos de uso")).toHaveLength(2);

    await fireEvent.press(screen.getByRole("link", { name: "Termos de uso" }));
    expect(screen.getAllByText("Termos de uso")).toHaveLength(1);
  });
});
