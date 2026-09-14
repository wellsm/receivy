import * as ImagePicker from "expo-image-picker";
import { pickAndUploadAvatar } from "@/account/avatar";

jest.mock("expo/fetch", () => ({ fetch: jest.fn(async () => ({ ok: true })) }));
jest.mock("expo-file-system", () => ({ File: jest.fn().mockImplementation((uri: string) => ({ uri })) }));

const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;

function client() {
  return {
    startAvatarUpload: jest.fn(async () => ({ uploadUrl: "https://bucket.test/put", expiresAt: "x" })),
    completeAvatarUpload: jest.fn(async () => ({ url: "https://bucket.test/get", version: "v1" })),
  };
}

it("returns null when the picker is cancelled", async () => {
  launch.mockResolvedValueOnce({ canceled: true, assets: null });

  await expect(pickAndUploadAvatar(client())).resolves.toBeNull();
});

it("opens a square editor and uploads the picked image", async () => {
  const api = client();
  launch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///p.jpg", mimeType: "image/jpeg", fileSize: 2048, width: 1, height: 1 }] });

  await expect(pickAndUploadAvatar(api)).resolves.toEqual({ url: "https://bucket.test/get", version: "v1" });

  expect(launch).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
  expect(api.startAvatarUpload).toHaveBeenCalledWith("image/jpeg");
  expect(api.completeAvatarUpload).toHaveBeenCalled();
});

it("rejects files the API would refuse without calling it", async () => {
  const api = client();
  launch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///p.heic", mimeType: "image/heic", fileSize: 2048, width: 1, height: 1 }] });

  await expect(pickAndUploadAvatar(api)).rejects.toThrow("Envie uma imagem JPG ou PNG de até 2 MB.");
  expect(api.startAvatarUpload).not.toHaveBeenCalled();
});
