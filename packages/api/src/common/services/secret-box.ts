import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function assertCredentialKeyConfigured(keyB64: string): string {
  if (!keyB64 || keyB64 === 'disabled' || Buffer.from(keyB64, 'base64').length !== KEY_BYTES) {
    throw new Error('Payment credential key is not configured');
  }

  return keyB64;
}

function unreadable(): never {
  throw new Error('Sealed value is not readable');
}

/** AES-256-GCM with a fresh IV per call: the same secret sealed twice never looks the same at rest. */
export function seal(plain: string, keyB64: string): string {
  const key = Buffer.from(assertCredentialKeyConfigured(keyB64), 'base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function open(sealed: string, keyB64: string): string {
  const [version, rawIv, rawTag, rawCiphertext, extra] = sealed.split('.');

  if (version !== VERSION || !rawIv || !rawTag || !rawCiphertext || extra !== undefined) {
    unreadable();
  }

  try {
    const key = Buffer.from(assertCredentialKeyConfigured(keyB64), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(rawIv, 'base64url'));

    decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));

    return Buffer.concat([decipher.update(Buffer.from(rawCiphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    unreadable();
  }
}
