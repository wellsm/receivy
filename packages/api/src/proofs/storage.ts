import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readBounded, type ProofMime } from "./validation";

export interface ProofStorage {
  uploadUrl(key: string, mime: ProofMime, size: number): Promise<string>;
  read(key: string): Promise<Buffer>;
  write(key: string, bytes: Buffer, mime: ProofMime): Promise<void>;
  delete(key: string): Promise<void>;
  downloadUrl(key: string, mime: ProofMime): Promise<string>;
}

export interface ReconciliableProofStorage extends ProofStorage {
  list(cursor?: string): Promise<{ objects: { key: string; modifiedAt: string }[]; cursor: string | null }>;
}

export function s3ProofStorage(bucket: string): ReconciliableProofStorage {
  if (!bucket || bucket === "disabled") throw new Error("Private proof bucket is not configured.");
  // Presigning an absent Body must not sign the SDK's CRC32 of an empty upload.
  // Finalization independently hashes the actual bounded bytes.
  const client = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
  return {
    async list(cursor) {
      const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 100, ContinuationToken: cursor }));
      return { objects: (response.Contents ?? []).flatMap(object => object.Key && object.LastModified ? [{ key: object.Key, modifiedAt: object.LastModified.toISOString() }] : []),
        cursor: response.IsTruncated ? response.NextContinuationToken ?? null : null };
    },
    uploadUrl: (key, mime, size) => getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key,
      ContentType: mime, ContentLength: size }), { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) }),
    async read(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error("Proof object unavailable.");
      const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
      try { return await readBounded(body); } finally { body.destroy?.(); }
    },
    async write(key, bytes, mime) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
      ContentType: mime, ContentLength: bytes.length, ServerSideEncryption: "AES256", IfNoneMatch: "*" })); },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    downloadUrl: (key, mime) => getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key,
      ResponseContentType: mime, ResponseContentDisposition: `attachment; filename="comprovante.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}"`,
      ResponseCacheControl: "private, no-store" }), { expiresIn: 60 }),
  };
}
