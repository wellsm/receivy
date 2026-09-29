import { clearSession, getAccessToken, hasSession, loadRefreshToken, SESSION_STORAGE_KEY, storeSession, watchSessionRemoval } from "./session";

const tokens = { accessToken: "access", refreshToken: "refresh", expiresIn: 900 };

beforeEach(() => {
  clearSession();
  localStorage.clear();
});

describe("session", () => {
  it("starts empty", () => {
    expect(hasSession()).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it("keeps the access token in memory and the refresh token in storage", () => {
    storeSession(tokens);

    expect(getAccessToken()).toBe("access");
    expect(loadRefreshToken()).toBe("refresh");
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toContain("access");
    expect(hasSession()).toBe(true);
  });

  it("clears both", () => {
    storeSession(tokens);
    clearSession();

    expect(getAccessToken()).toBeNull();
    expect(loadRefreshToken()).toBeNull();
  });

  it("treats an unavailable storage as no session", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(hasSession()).toBe(false);
    expect(() => storeSession(tokens)).not.toThrow();
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "{not json");

    expect(loadRefreshToken()).toBeNull();
  });

  it("notifies when another tab removes the session", () => {
    storeSession(tokens);

    const onRemoved = vi.fn();
    const stop = watchSessionRemoval(onRemoved);

    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_STORAGE_KEY, newValue: null }));
    expect(getAccessToken()).toBeNull();
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: null }));
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_STORAGE_KEY, newValue: null }));

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("notifies when another tab clears the whole storage", () => {
    storeSession(tokens);

    const onRemoved = vi.fn();
    const stop = watchSessionRemoval(onRemoved);

    window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
    stop();

    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });
});
