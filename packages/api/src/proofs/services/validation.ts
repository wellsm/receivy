import { createHash } from 'node:crypto';
import { ProofMime } from '@receivy/common';
import { ProofInvalidFileError, ProofTooLargeError } from '../errors';

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export async function readBounded(stream: AsyncIterable<Uint8Array>, limit = MAX_PROOF_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw new ProofTooLargeError();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
export function validateProof(bytes: Buffer, claimedMime: string) {
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) throw new ProofTooLargeError();
  const mime: ProofMime | undefined = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? ProofMime.Jpeg
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? ProofMime.Png
      : bytes.subarray(0, 5).toString() === '%PDF-'
        ? ProofMime.Pdf
        : undefined;
  if (!mime || mime !== claimedMime) throw new ProofInvalidFileError();
  return { mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
