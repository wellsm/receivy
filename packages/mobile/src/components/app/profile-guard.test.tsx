import { render, waitFor } from "@testing-library/react-native";
import { ProfileGuard, isGuardedPath } from "@/components/app/profile-guard";

const mockReplace = jest.fn();
let mockPathname = "/";

jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

const named = { name: "Ana" };
const unnamed = { name: null };

function store(user: { name: string | null }, session = true) {
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
    expect(isGuardedPath("/people")).toBe(true);
    expect(isGuardedPath("/charges/abc")).toBe(true);
    expect(isGuardedPath("/settings")).toBe(true);
  });
});

describe("ProfileGuard", () => {
  it("sends a signed-in person without a name to onboarding", async () => {
    mockPathname = "/people";

    await render(<ProfileGuard store={store(unnamed)} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
  });

  it("does nothing when the profile already has a name", async () => {
    const profiles = store(named);

    await render(<ProfileGuard store={profiles} />);

    await waitFor(() => expect(profiles.load).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("skips public screens and sessions that are not established yet", async () => {
    mockPathname = "/login";
    const publicScreen = store(unnamed);
    await render(<ProfileGuard store={publicScreen} />);

    mockPathname = "/";
    const noSession = store(unnamed, false);
    await render(<ProfileGuard store={noSession} />);

    expect(publicScreen.load).not.toHaveBeenCalled();
    expect(noSession.load).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
