import { readEnv } from "./env";

describe("readEnv", () => {
  it("throws without VITE_API_URL", () => {
    vi.stubEnv("VITE_API_URL", "");

    expect(() => readEnv()).toThrow("VITE_API_URL");
  });

  it("strips the trailing slash and reads the flags", () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:3735/local-receivy-api/");
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "true");

    const env = readEnv();

    expect(env.apiUrl).toBe("http://127.0.0.1:3735/local-receivy-api");
    expect(env.whatsappEnabled).toBe(true);
    expect(env.evolutionEnabled).toBe(false);
  });

  it("reads the avatar bucket origin, empty as null", () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:3735/local-receivy-api");
    vi.stubEnv("VITE_AVATAR_ORIGIN", " https://avatars.s3.sa-east-1.amazonaws.com ");

    expect(readEnv().avatarOrigin).toBe("https://avatars.s3.sa-east-1.amazonaws.com");

    vi.stubEnv("VITE_AVATAR_ORIGIN", "");

    expect(readEnv().avatarOrigin).toBeNull();
  });
});
