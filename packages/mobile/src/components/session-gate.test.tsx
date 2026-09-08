import { render, screen, waitFor } from "@testing-library/react-native";
import { SessionGate } from "./session-gate";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("./home-screen", () => ({
  HomeScreen: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Home tabs</Text>;
  },
}));

const named = { name: "Ana" };
const unnamed = { name: null };

function deps(user: { name: string | null }, token: string | null = "token") {
  const client = { getAccessToken: () => token, refresh: jest.fn().mockResolvedValue({}) };
  const store = { load: jest.fn().mockResolvedValue(user) };

  return { client, store };
}

beforeEach(() => mockReplace.mockReset());

describe("SessionGate", () => {
  it("routes to onboarding before rendering the home tabs when the name is missing", async () => {
    await render(<SessionGate {...deps(unnamed)} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Home tabs")).toBeNull();
  });

  it("renders the home tabs once the profile has a name", async () => {
    await render(<SessionGate {...deps(named)} />);

    expect(await screen.findByText("Home tabs")).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("refreshes a stored session first and falls back to login when that fails", async () => {
    const { client, store } = deps(named, null);
    client.refresh.mockRejectedValue(new Error("expired"));

    await render(<SessionGate client={client} store={store} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    expect(store.load).not.toHaveBeenCalled();
    expect(screen.queryByText("Home tabs")).toBeNull();
  });
});
