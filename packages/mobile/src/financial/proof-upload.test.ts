import { pickAndUploadProof, UPLOAD_UNCONFIRMED } from "./proof-upload";
import * as Picker from "expo-document-picker";
import { fetch as expoFetch } from "expo/fetch";
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class { size = 14; uri: string; constructor(value: string) { this.uri = value; } } }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
const picker = jest.mocked(Picker.getDocumentAsync); const put = jest.mocked(expoFetch);
const picked = { canceled: false as const, assets: [{ uri: "file:///cache/proof.pdf", name: "proof.pdf", mimeType: "application/pdf", size: 14, lastModified: 0 }] };
const ticket = { uploadUrl: "https://private.test/put", expiresAt: "2026-09-11T10:05:00Z" };
beforeEach(() => { jest.resetAllMocks(); jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());
test("canceling selection creates no upload ticket", async () => {
  picker.mockResolvedValue({ canceled: true, assets: null }); const client = { startProofUpload: jest.fn(), charge: jest.fn() };
  expect(await pickAndUploadProof("id", client)).toBeNull(); expect(client.startProofUpload).not.toHaveBeenCalled();
});
test("uploads the picked File and polls the charge until the proof is pending", async () => {
  picker.mockResolvedValue(picked); put.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof expoFetch>>);
  const client = { startProofUpload: jest.fn().mockResolvedValue(ticket), charge: jest.fn().mockResolvedValueOnce({ id: "charge", proof: null }).mockResolvedValue({ id: "charge", proof: { state: "pending" } }) };
  const pending = pickAndUploadProof("charge", client);
  await jest.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual({ id: "charge", proof: { state: "pending" } });
  expect(client.startProofUpload).toHaveBeenCalledWith("charge", { filename: "proof.pdf", mime: "application/pdf", size: 14 });
  expect(put.mock.calls[0]?.[1]?.body).toMatchObject({ uri: "file:///cache/proof.pdf" });
  expect(put.mock.calls[0]?.[1]?.headers).toEqual({ "content-type": "application/pdf" });
  expect(client.charge).toHaveBeenCalledTimes(2);
});
test("gives up after thirty seconds without a pending proof", async () => {
  picker.mockResolvedValue(picked); put.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof expoFetch>>);
  const client = { startProofUpload: jest.fn().mockResolvedValue(ticket), charge: jest.fn().mockResolvedValue({ id: "charge", proof: null }) };
  const pending = pickAndUploadProof("charge", client); const failure = pending.catch((reason: Error) => reason);
  await jest.advanceTimersByTimeAsync(31000);
  expect(await failure).toEqual(new Error(UPLOAD_UNCONFIRMED));
  expect(client.charge).toHaveBeenCalledTimes(30);
});
