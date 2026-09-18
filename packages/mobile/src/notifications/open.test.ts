import { notificationUrl } from "./open";

it("opens only the configured public charge capability path, not arbitrary notification URLs", () => {
  expect(
    notificationUrl(
      "https://receivy.example/pay/id.123.mac",
      "https://receivy.example",
    ),
  ).toBe("https://receivy.example/pay/id.123.mac");

  for (const url of [
    "https://evil.example/pay/token",
    "javascript:alert(1)",
    "https://receivy.example/settings",
    "https://receivy.example/pay/token?redirect=evil",
  ]) {
    expect(notificationUrl(url, "https://receivy.example")).toBeNull();
  }
});
it("opens a billing by its uuid and nothing else under /billings", () => {
  expect(
    notificationUrl(
      "https://receivy.example/billings/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b",
      "https://receivy.example",
    ),
  ).toBe("https://receivy.example/billings/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b");
  expect(notificationUrl("https://receivy.example/billings/x", "https://receivy.example")).toBeNull();
});
it("opens a charge by its uuid, which is where payment notices point", () => {
  expect(
    notificationUrl("https://receivy.example/charges/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b", "https://receivy.example"),
  ).toBe("https://receivy.example/charges/2b7c1b0e-1e2f-4c3d-8a9b-0c1d2e3f4a5b");
  expect(notificationUrl("https://receivy.example/charges/x", "https://receivy.example")).toBeNull();
});
