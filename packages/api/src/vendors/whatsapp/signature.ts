import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const HEX_DIGEST = /^[0-9a-f]{64}$/i;

/**
 * Validates Meta's `X-Hub-Signature-256` against the raw body: a re-serialised body does not match,
 * the signature is over the bytes that arrived. Constant-time comparison, because the whole
 * internet can call the route. An empty or placeholder secret refuses everything: an unset
 * variable must not turn into an open webhook.
 */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
  if (!appSecret || appSecret === 'disabled' || !header || !header.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const received = header.slice(SIGNATURE_PREFIX.length);

  // Buffer.from(hex) truncates silently on bad characters and timingSafeEqual then throws on length.
  if (!HEX_DIGEST.test(received)) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

/** Evolution sends back the `authorization` header we registered on the instance; empties never match. */
export function verifyEvolutionSecret(expected: string, header: string | undefined): boolean {
  if (!expected || !header) {
    return false;
  }

  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
