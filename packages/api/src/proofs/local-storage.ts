import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, unlink, opendir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, isAbsolute, join, relative } from "node:path";
import { MAX_PROOF_BYTES, readBounded, type ProofMime } from "./validation.ts";
import type { ReconciliableProofStorage } from "./storage";

type Config = { directory: string; secret: string; baseUrl: string };
const KEY = /^(temporary|proofs)\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/;
function file(directory: string, key: string) { if (!isAbsolute(directory) || !KEY.test(key)) throw new Error("Invalid local storage path."); return join(directory, key); }
function signature(secret: string, payload: string) { if (secret.length < 32) throw new Error("Local storage signing secret is not configured."); return createHmac("sha256", secret).update(payload).digest("hex"); }
export function localProofStorage(config: Config): ReconciliableProofStorage {
  const url = new URL(config.baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || !isAbsolute(config.directory)) throw new Error("Local proof storage requires a loopback HTTP server and absolute directory.");
  signature(config.secret, "configuration-check");
  function sign(key: string, method: string, mime: ProofMime, size: number, ttl: number) {
    file(config.directory, key);
    const payload = Buffer.from(JSON.stringify({ key, method, mime, size, expires: Date.now() + ttl * 1000 })).toString("base64url");
    return `${config.baseUrl}/objects?grant=${payload}.${signature(config.secret, payload)}`;
  }
  return {
    async list(cursor) {
      await mkdir(config.directory, { recursive: true });
      const directory = await opendir(config.directory, { recursive: true });
      const objects: { key: string; modifiedAt: string }[] = [];
      let position = 0; const start = cursor ? Number(cursor) : 0;
      if (!Number.isSafeInteger(start) || start < 0) throw new Error("Invalid local listing cursor.");
      for await (const entry of directory) {
        if (!entry.isFile()) continue;
        if (position++ < start) continue;
        const path = join(entry.parentPath, entry.name); const key = relative(config.directory, path);
        if (KEY.test(key)) objects.push({ key, modifiedAt: (await stat(path)).mtime.toISOString() });
        if (objects.length === 100) return { objects, cursor: String(position) };
      }
      return { objects, cursor: null };
    },
    uploadUrl: async (key, mime, size) => { if (!key.startsWith("temporary/") || size > MAX_PROOF_BYTES || size <= 0) throw new Error("Invalid upload."); return sign(key, "PUT", mime, size, 300); },
    read: key => readBounded(createReadStream(file(config.directory, key))),
    async write(key, bytes) { const path = file(config.directory, key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); },
    async delete(key) { await unlink(file(config.directory, key)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
    downloadUrl: async (key, mime) => { if (!key.startsWith("proofs/")) throw new Error("Only finalized proofs can be downloaded."); return sign(key, "GET", mime, 0, 60); },
  };
}

/** Explicit loopback-only development server. No request/URL/filename logging. */
export async function startLocalProofServer(config: { directory: string; secret: string; origin: string; port: number }) {
  signature(config.secret, "configuration-check");
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.headers.origin === config.origin) {
      response.setHeader("Access-Control-Allow-Origin", config.origin); response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "PUT, GET, OPTIONS"); response.setHeader("Access-Control-Allow-Headers", "content-type");
    }
    if (request.method === "OPTIONS") { response.writeHead(request.headers.origin === config.origin ? 204 : 403).end(); return; }
    try {
      const url = new URL(request.url ?? "", "http://localhost"); const parts = (url.searchParams.get("grant") ?? "").split(".");
      const [payload, supplied] = parts; const expected = payload ? signature(config.secret, payload) : "";
      if (url.pathname !== "/objects" || parts.length !== 2 || !supplied || supplied.length !== expected.length
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { response.writeHead(403).end(); return; }
      const grant = JSON.parse(Buffer.from(payload!, "base64url").toString()) as { key: string; method: string; mime: ProofMime; size: number; expires: number };
      if (grant.method !== request.method || grant.expires <= Date.now()) { response.writeHead(403).end(); return; }
      const path = file(config.directory, grant.key);
      if (request.method === "PUT" && grant.key.startsWith("temporary/")) {
        if (request.headers["content-type"] !== grant.mime || Number(request.headers["content-length"]) !== grant.size) { response.writeHead(422).end(); return; }
        const bytes = await readBounded(request, Math.min(grant.size, MAX_PROOF_BYTES));
        if (bytes.length !== grant.size) { response.writeHead(422).end(); return; }
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { mode: 0o600 }); response.writeHead(204).end();
      } else if (request.method === "GET" && grant.key.startsWith("proofs/")) {
        const bytes = await readBounded(createReadStream(path));
        response.setHeader("Content-Type", grant.mime);
        response.setHeader("Content-Disposition", `attachment; filename="comprovante.${grant.mime === "application/pdf" ? "pdf" : grant.mime === "image/png" ? "png" : "jpg"}"`);
        response.writeHead(200).end(bytes);
      } else response.writeHead(403).end();
    } catch { if (!response.headersSent) response.writeHead(422); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Local server unavailable.");
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
