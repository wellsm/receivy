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
  ])
    expect(notificationUrl(url, "https://receivy.example")).toBeNull();
});
