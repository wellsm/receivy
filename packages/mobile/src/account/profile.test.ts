import { UserStatus } from "@receivy/common";
import { createProfileStore } from "./profile";

const user = {
  id: "user",
  email: "ana@example.com",
  name: "Ana",
  phone: null,
  avatar: null,
  status: UserStatus.Active,
  locale: "pt-BR" as const,
  timezone: "America/Sao_Paulo",
  country: "BR" as const,
  currency: "BRL" as const,
};

describe("profile store", () => {
  it("fetches the profile once per access token", async () => {
    const fetchProfile = jest.fn().mockResolvedValue(user);
    let token: string | null = "token-a";
    const store = createProfileStore({ getAccessToken: () => token, fetchProfile });

    await expect(store.load()).resolves.toEqual(user);
    await expect(store.load()).resolves.toEqual(user);
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    token = "token-b";
    await store.load();
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it("reports whether a session exists and forgets the profile without a token", () => {
    let token: string | null = "token";
    const store = createProfileStore({ getAccessToken: () => token, fetchProfile: jest.fn() });

    expect(store.hasSession()).toBe(true);
    store.remember(user);

    token = null;
    expect(store.hasSession()).toBe(false);
  });

  it("reuses a remembered profile saved by a screen", async () => {
    const fetchProfile = jest.fn();
    const store = createProfileStore({ getAccessToken: () => "token", fetchProfile });

    store.remember({ ...user, name: "Ana Souza" });

    await expect(store.load()).resolves.toMatchObject({ name: "Ana Souza" });
    expect(fetchProfile).not.toHaveBeenCalled();
  });
});
