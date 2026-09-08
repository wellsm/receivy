import { createHash } from 'node:crypto';
import { HttpUnprocessableEntityError } from '@ez4/gateway';

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export type ProofMime = 'image/jpeg' | 'image/png' | 'application/pdf';
export async function readBounded(stream: AsyncIterable<Uint8Array>, limit = MAX_PROOF_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) throw new HttpUnprocessableEntityError('O comprovante deve ter no máximo 10 MB.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
export function validateProof(bytes: Buffer, claimedMime: string) {
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) throw new HttpUnprocessableEntityError('O comprovante deve ter no máximo 10 MB.');
  const mime: ProofMime | undefined = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes.subarray(0, 5).toString() === '%PDF-'
        ? 'application/pdf'
        : undefined;
  if (!mime || mime !== claimedMime) throw new HttpUnprocessableEntityError('Envie um arquivo JPG, PNG ou PDF válido.');
  return { mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
