import { fireEvent, render, screen } from "@testing-library/react-native";
import { avatarCacheKey, InitialsAvatar } from "@/components/ui/initials-avatar";

it("shows the initial without a photo", async () => {
  await render(<InitialsAvatar name="ana" size={40} />);

  expect(screen.getByText("A")).toBeTruthy();
});

it("shows the photo keyed on the object and version, and falls back on error", async () => {
  const avatar = { url: "https://bucket.test/avatars/u1?X-Amz-Signature=abc", version: "v1" };

  await render(<InitialsAvatar name="ana" size={40} avatar={avatar} />);

  const image = screen.getByTestId("initials-avatar-photo");

  // expo-image normalizes a single source into a one-element array before it reaches the host props.
  expect(image.props.source).toEqual([{ uri: avatar.url, cacheKey: "/avatars/u1:v1" }]);
  expect(screen.queryByText("A")).toBeNull();

  // expo-image's ExpoImage.onError unwraps `event.nativeEvent`, so the fired event needs that shape.
  await fireEvent(image, "error", { nativeEvent: {} });

  expect(screen.getByText("A")).toBeTruthy();
});

it("builds the cache key without the signature", () => {
  expect(avatarCacheKey({ url: "https://bucket.test/avatars/u2?sig=1", version: "2026" })).toBe("/avatars/u2:2026");
});
