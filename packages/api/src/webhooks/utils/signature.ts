import { createHash, timingSafeEqual } from 'node:crypto';

/** PagBank signs a notification as SHA-256 of `<seller token>-<raw body>`; a single reformatted space breaks it, so the body is taken as received. */
export function signatureOf(credential: string, rawBody: string): string {
  return createHash('sha256').update(`${credential}-${rawBody}`).digest('hex');
}

export function signatureMatches(expected: string, received: string | undefined): boolean {
  if (!received || received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
}
