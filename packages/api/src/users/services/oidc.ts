import { createPublicKey, type JsonWebKey as NodeJsonWebKey, verify } from 'node:crypto';
import { normalizeEmail } from '@receivy/common';

export const enum SupportedAlgorithm {
  Es256 = 'ES256',
  Rs256 = 'RS256'
}

type Jwk = NodeJsonWebKey & {
  alg?: string;
  kid?: string;
  use?: string;
};

type Jwks = { keys: Jwk[] };

type VerifyOidcIdTokenInput = {
  algorithms: readonly SupportedAlgorithm[];
  audience: string;
  issuers: readonly string[];
  jwks: Jwks;
  nonce: string;
  nowSeconds?: number;
  token: string;
};

export type OidcIdentity = {
  email: string;
  emailAuthoritative?: boolean;
  name?: string;
  picture?: string;
  subject: string;
};

function invalidToken(): never {
  throw new Error('Invalid identity token');
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalidToken();
    }
    return value as Record<string, unknown>;
  } catch {
    return invalidToken();
  }
}

function includesAudience(claim: unknown, expected: string): boolean {
  return claim === expected || (Array.isArray(claim) && claim.every((item) => typeof item === 'string') && claim.includes(expected));
}

function isVerifiedEmail(value: unknown): boolean {
  return value === true || value === 'true';
}

export function verifyOidcIdToken({
  algorithms,
  audience,
  issuers,
  jwks,
  nonce,
  nowSeconds = Math.floor(Date.now() / 1000),
  token
}: VerifyOidcIdTokenInput): OidcIdentity {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return invalidToken();
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return invalidToken();
  }

  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  const algorithm = header.alg;
  const kid = header.kid;

  if (
    (algorithm !== SupportedAlgorithm.Rs256 && algorithm !== SupportedAlgorithm.Es256) ||
    !algorithms.includes(algorithm) ||
    typeof kid !== 'string'
  ) {
    return invalidToken();
  }

  const jwk = jwks.keys.find(
    (candidate) => candidate.kid === kid && (!candidate.alg || candidate.alg === algorithm) && (!candidate.use || candidate.use === 'sig')
  );
  if (!jwk) {
    return invalidToken();
  }

  try {
    const publicKey = createPublicKey({
      format: 'jwk',
      key: jwk
    });
    const validSignature = verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      algorithm === SupportedAlgorithm.Es256 ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey,
      Buffer.from(encodedSignature, 'base64url')
    );
    if (!validSignature) {
      return invalidToken();
    }
  } catch {
    return invalidToken();
  }

  if (
    typeof payload.iss !== 'string' ||
    !issuers.includes(payload.iss) ||
    !includesAudience(payload.aud, audience) ||
    (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience) ||
    (payload.azp !== undefined && payload.azp !== audience) ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSeconds ||
    !Number.isFinite(payload.exp) ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSeconds + 60 ||
    !Number.isFinite(payload.iat) ||
    (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSeconds)) ||
    payload.nonce !== nonce ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.email !== 'string' ||
    !payload.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    !isVerifiedEmail(payload.email_verified)
  ) {
    return invalidToken();
  }

  return {
    subject: payload.sub,
    email: normalizeEmail(payload.email),
    emailAuthoritative:
      payload.iss === 'https://appleid.apple.com' ||
      ((payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com') &&
        (normalizeEmail(payload.email).endsWith('@gmail.com') || (typeof payload.hd === 'string' && payload.hd.length > 0))),
    ...(typeof payload.name === 'string' && payload.name.trim() ? { name: payload.name.trim().slice(0, 120) } : {}),
    ...(typeof payload.picture === 'string' && payload.picture ? { picture: payload.picture } : {})
  };
}
