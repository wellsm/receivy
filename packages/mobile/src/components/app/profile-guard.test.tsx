import { render, waitFor } from "@testing-library/react-native";
import { ProfileGuard, isGuardedPath } from "@/components/app/profile-guard";

const mockReplace = jest.fn();
let mockPathname = "/";

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

const active = { name: "Ana", status: "active" as const };
const pending = { name: null, status: "pending" as const };

function store(user: { name: string | null; status: "pending" | "active" }, session = true) {
  return { hasSession: () => session, load: jest.fn().mockResolvedValue(user) };
}

beforeEach(() => {
  mockReplace.mockReset();
  mockPathname = "/";
});

describe("isGuardedPath", () => {
  it("leaves login, onboarding and auth callbacks alone", () => {
    expect(isGuardedPath("/login")).toBe(false);
    expect(isGuardedPath("/login/code")).toBe(false);
    expect(isGuardedPath("/onboarding")).toBe(false);
    expect(isGuardedPath("/auth/callback")).toBe(false);
  });

  it("guards every app screen", () => {
    expect(isGuardedPath("/")).toBe(true);
    expect(isGuardedPath("/contacts")).toBe(true);
    expect(isGuardedPath("/charges/abc")).toBe(true);
    expect(isGuardedPath("/settings")).toBe(true);
  });
});

describe("ProfileGuard", () => {
  it("sends a signed-in person with a pending account to onboarding", async () => {
    mockPathname = "/contacts";

    await render(<ProfileGuard store={store(pending)} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
  });

  it("sends an account that has a name but is still pending to onboarding", async () => {
    await render(<ProfileGuard store={store({ name: "Ana", status: "pending" })} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
  });

  it("does nothing when the account is active", async () => {
    const profiles = store(active);

    await render(<ProfileGuard store={profiles} />);

    await waitFor(() => expect(profiles.load).toHaveBeenCalled());

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("skips public screens and sessions that are not established yet", async () => {
    mockPathname = "/login";

    const publicScreen = store(pending);

    await render(<ProfileGuard store={publicScreen} />);

    mockPathname = "/";

    const noSession = store(pending, false);

    await render(<ProfileGuard store={noSession} />);

    expect(publicScreen.load).not.toHaveBeenCalled();
    expect(noSession.load).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
