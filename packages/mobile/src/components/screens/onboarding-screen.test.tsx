import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";

const user = {
  id: "user",
  email: "ana@example.com",
  name: null,
  avatarUrl: null,
  locale: "pt-BR" as const,
  timezone: "America/Sao_Paulo",
  country: "BR" as const,
  currency: "BRL" as const,
};

async function setup(save = jest.fn().mockResolvedValue({ ...user, name: "Ana" })) {
  const remember = jest.fn();
  const onComplete = jest.fn();

  await render(<OnboardingScreen client={{ save }} store={{ remember }} onComplete={onComplete} />);

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
