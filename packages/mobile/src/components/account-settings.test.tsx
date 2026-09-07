import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccountSettings } from "./account-settings";
const user = { id: "user", email: "fixture@example.com", name: "Ana", avatarUrl: null, locale: "pt-BR" as const, timezone: "America/Sao_Paulo", country: "BR" as const, currency: "BRL" as const };
it.each([true, false])("requires explicit deletion text and distinguishes confirmation from lost auth (%s)", async success => {
  const client = { profile: jest.fn().mockResolvedValue(user), sessions: jest.fn().mockResolvedValue([]), save: jest.fn(), revoke: jest.fn(), export: jest.fn(), erase: jest.fn().mockResolvedValue(success), logout: jest.fn() };
  await render(<AccountSettings client={client} />);
  await fireEvent.press(await screen.findByText("Excluir conta definitivamente"));
  expect(client.erase).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
  await fireEvent.press(screen.getByText("Excluir conta definitivamente"));
  expect(await screen.findByText(success ? "Conta excluída. A remoção de arquivos será concluída em segundo plano." : "Sessão encerrada; não foi possível confirmar a exclusão.")).toBeOnTheScreen();
});
