import { pickAndUploadProof } from "./proof-upload";
import * as Picker from "expo-document-picker";
import { fetch as expoFetch } from "expo/fetch";
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class { size = 14; uri: string; constructor(value: string) { this.uri = value; } } }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
const picker = jest.mocked(Picker.getDocumentAsync); const put = jest.mocked(expoFetch);
beforeEach(() => jest.resetAllMocks());
test("canceling selection creates no upload intent", async () => {
  picker.mockResolvedValue({ canceled: true, assets: null }); const client = { uploadIntent: jest.fn(), finalizeProof: jest.fn() };
  expect(await pickAndUploadProof("id", client)).toBeNull(); expect(client.uploadIntent).not.toHaveBeenCalled();
});
test("uploads the picked File before finalizing the intent", async () => {
  picker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///cache/proof.pdf", name: "proof.pdf", mimeType: "application/pdf", size: 14, lastModified: 0 }] });
  put.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof expoFetch>>);
  const client = { uploadIntent: jest.fn().mockResolvedValue({ id: "intent", uploadUrl: "https://private.test/put" }), finalizeProof: jest.fn().mockResolvedValue({ state: "pending" }) };
  expect(await pickAndUploadProof("charge", client)).toEqual({ state: "pending" });
  expect(client.uploadIntent).toHaveBeenCalledWith("charge", { filename: "proof.pdf", mime: "application/pdf", size: 14 });
  expect(put.mock.calls[0]?.[1]?.body).toMatchObject({ uri: "file:///cache/proof.pdf" });
  expect(client.finalizeProof).toHaveBeenCalledWith("charge", "intent");
});
