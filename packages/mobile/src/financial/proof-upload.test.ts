import { pickAndUploadProof } from "./proof-upload";
import * as Picker from "expo-document-picker";
import { fetch as expoFetch } from "expo/fetch";

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class { size = 14; uri: string; constructor(value: string) { this.uri = value; } } }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

const picker = jest.mocked(Picker.getDocumentAsync); const put = jest.mocked(expoFetch);
const picked = { canceled: false as const, assets: [{ uri: "file:///cache/proof.pdf", name: "proof.pdf", mimeType: "application/pdf", size: 14, lastModified: 0 }] };
const ticket = { uploadUrl: "https://private.test/put", expiresAt: "2026-09-11T10:05:00Z" };

beforeEach(() => { jest.resetAllMocks(); });
test("canceling selection creates no upload ticket", async () => {
  picker.mockResolvedValue({ canceled: true, assets: null });

 const client = { startProofUpload: jest.fn(), completeProofUpload: jest.fn() };

  expect(await pickAndUploadProof("id", client)).toBeNull(); expect(client.startProofUpload).not.toHaveBeenCalled();
});
test("uploads the picked File and completes the upload", async () => {
  picker.mockResolvedValue(picked); put.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof expoFetch>>);

  const client = { startProofUpload: jest.fn().mockResolvedValue(ticket), completeProofUpload: jest.fn().mockResolvedValue({ id: "charge", proof: { state: "pending" } }) };

  expect(await pickAndUploadProof("charge", client)).toEqual({ id: "charge", proof: { state: "pending" } });
  expect(client.startProofUpload).toHaveBeenCalledWith("charge", { filename: "proof.pdf", mime: "application/pdf", size: 14 });
  expect(put.mock.calls[0]?.[1]?.body).toMatchObject({ uri: "file:///cache/proof.pdf" });
  expect(put.mock.calls[0]?.[1]?.headers).toEqual({ "content-type": "application/pdf" });
  expect(client.completeProofUpload).toHaveBeenCalledWith("charge");
});
test("never completes an upload whose bytes were refused", async () => {
  picker.mockResolvedValue(picked); put.mockResolvedValue({ ok: false } as Awaited<ReturnType<typeof expoFetch>>);

  const client = { startProofUpload: jest.fn().mockResolvedValue(ticket), completeProofUpload: jest.fn() };

  await expect(pickAndUploadProof("charge", client)).rejects.toThrow("O arquivo não foi enviado.");

  expect(client.completeProofUpload).not.toHaveBeenCalled();
});
