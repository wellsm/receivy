import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_ISSUER = 'receivy-api';
const TOKEN_AUDIENCE = 'receivy-clients';

type RandomBytes = (size: number) => Buffer;

type AccessTokenInput = {
  familyId: string;
  nowSeconds?: number;
  secret: string;
  userId: string;
};

type VerifyAccessTokenInput = {
  nowSeconds?: number;
  secret: string;
  token: string;
};

type AccessTokenPayload = {
  aud: typeof TOKEN_AUDIENCE;
  exp: number;
  iat: number;
  iss: typeof TOKEN_ISSUER;
  sid: string;
  sub: string;
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

function invalidToken(): never {
  throw new Error('Invalid session token');
}

export function issueAccessToken({ familyId, nowSeconds = Math.floor(Date.now() / 1000), secret, userId }: AccessTokenInput): string {
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    aud: TOKEN_AUDIENCE,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    iat: nowSeconds,
    iss: TOKEN_ISSUER,
    sid: familyId,
    sub: userId
  } satisfies AccessTokenPayload);
  const signature = sign(`${header}.${payload}`, secret).toString('base64url');

  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken({ nowSeconds = Math.floor(Date.now() / 1000), secret, token }: VerifyAccessTokenInput): {
  familyId: string;
  userId: string;
} {
  const segments = token.split('.');

  if (segments.length !== 3) {
    return invalidToken();
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return invalidToken();
  }

  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const actualSignature = Buffer.from(encodedSignature, 'base64url');

  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return invalidToken();
  }

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<AccessTokenPayload>;

    if (
      header.alg !== 'HS256' ||
      header.typ !== 'JWT' ||
      payload.iss !== TOKEN_ISSUER ||
      payload.aud !== TOKEN_AUDIENCE ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      payload.iat > nowSeconds ||
      payload.exp <= nowSeconds
    ) {
      return invalidToken();
    }

    return { familyId: payload.sid, userId: payload.sub };
  } catch {
    return invalidToken();
  }
}

export function generateRefreshToken(randomBytes: RandomBytes = nodeRandomBytes): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
