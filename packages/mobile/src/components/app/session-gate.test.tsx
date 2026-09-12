import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SessionGate } from "@/components/app/session-gate";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockRegisterPushDevice = jest.fn();

jest.mock("@/notifications/register", () => ({
  registerPushDevice: (...args: unknown[]) => mockRegisterPushDevice(...args),
}));

const named = { name: "Ana" };
const unnamed = { name: null };

function deps(user: { name: string | null }, token: string | null = "token") {
  const client = { getAccessToken: () => token, refresh: jest.fn().mockResolvedValue({}) };
  const store = { load: jest.fn().mockResolvedValue(user) };

  return { client, store };
}

beforeEach(() => {
  mockReplace.mockReset();
  mockRegisterPushDevice.mockReset();
  mockRegisterPushDevice.mockResolvedValue({ id: "d1" });
});

describe("SessionGate", () => {
  it("routes to onboarding before rendering the home tabs when the name is missing", async () => {
    await render(
      <SessionGate {...deps(unnamed)}>
        <Text>Home tabs</Text>
      </SessionGate>,
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Home tabs")).toBeNull();
  });

  it("renders the home tabs once the profile has a name", async () => {
    await render(
      <SessionGate {...deps(named)}>
        <Text>Home tabs</Text>
      </SessionGate>,
    );

    expect(await screen.findByText("Home tabs")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("registers the push device once the session is ready and ignores its failures", async () => {
    mockRegisterPushDevice.mockRejectedValue(new Error("permission denied"));

    await render(
      <SessionGate {...deps(named)}>
        <Text>Home tabs</Text>
      </SessionGate>,
    );

    expect(await screen.findByText("Home tabs")).toBeOnTheScreen();
    await waitFor(() => expect(mockRegisterPushDevice).toHaveBeenCalledTimes(1));
  });

  it("does not register the push device before the profile is ready", async () => {
    await render(
      <SessionGate {...deps(unnamed)}>
        <Text>Home tabs</Text>
      </SessionGate>,
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
    expect(mockRegisterPushDevice).not.toHaveBeenCalled();
  });

  it("refreshes a stored session first and falls back to login when that fails", async () => {
    const { client, store } = deps(named, null);
    client.refresh.mockRejectedValue(new Error("expired"));

    await render(
      <SessionGate client={client} store={store}>
        <Text>Home tabs</Text>
      </SessionGate>,
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    expect(store.load).not.toHaveBeenCalled();
    expect(screen.queryByText("Home tabs")).toBeNull();
  });
});
