import type { AuthUser } from "@receivy/common";
import type { DbClient } from "../database";
import type { AuthRepository, LoginCodeOutcome } from "../auth/email-login";
import type {
  RotateRefreshTokenOutcome,
  SessionRepository,
} from "../auth/refresh-session";
import {
  canAttemptEmailCode,
  createEmailCodeHash,
  verifyEmailCodeHash,
} from "../auth/code";
import { generateRefreshToken, hashRefreshToken } from "../auth/session";

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const LOGIN_CODE_SELECT = {
  id: true,
  code_hash: true,
  attempts: true,
  expires_at: true,
  consumed_at: true,
  created_at: true,
} as const;

function toAuthUser(row: {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  locale: "pt-BR";
  timezone: string;
  country: "BR";
  currency: "BRL";
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    avatarUrl: row.avatar_url ?? null,
    locale: row.locale,
    timezone: row.timezone,
    country: row.country,
    currency: row.currency,
  };
}

async function replaceLoginCode(
  db: DbClient,
  input: { code: string; codeHashKey: string; email: string },
): Promise<{ accepted: boolean }> {
  return db.transaction(async (tx): Promise<{ accepted: boolean }> => {
    const previous = await tx.login_codes.findOne({
      select: LOGIN_CODE_SELECT,
      where: { email: input.email },
      lock: true,
    });
    const now = new Date();

    if (
      previous &&
      now.getTime() - new Date(previous.created_at).getTime() < CODE_COOLDOWN_MS
    ) {
      return { accepted: false };
    }

    const data = {
      code_hash: createEmailCodeHash({
        code: input.code,
        normalizedEmail: input.email,
        secret: input.codeHashKey,
      }),
      attempts: 0,
      expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      consumed_at: null as unknown as string | undefined,
      created_at: now.toISOString(),
    };

    if (previous) {
      await tx.login_codes.updateOne({
        select: { id: true },
        data,
        where: { id: previous.id },
      });
    } else {
      await tx.login_codes.insertOne({
        select: { id: true },
        data: { id: crypto.randomUUID(), email: input.email, ...data },
      });
    }

    return { accepted: true };
  });
}

async function consumeLoginCode(
  db: DbClient,
  input: { code: string; codeHashKey: string; email: string },
): Promise<LoginCodeOutcome> {
  return db.transaction(async (tx): Promise<LoginCodeOutcome> => {
    const token = await tx.login_codes.findOne({
      select: LOGIN_CODE_SELECT,
      where: { email: input.email },
      lock: true,
    });

    if (!token) {
      return { kind: "invalid" };
    }

    const usable = canAttemptEmailCode({
      attempts: token.attempts,
      consumedAt: token.consumed_at ? new Date(token.consumed_at) : null,
      expiresAt: new Date(token.expires_at),
    });

    if (!usable) {
      return {
        kind: token.attempts >= 5 ? "exhausted" : "expired",
      };
    }

    const matches = verifyEmailCodeHash({
      code: input.code,
      codeHash: token.code_hash,
      normalizedEmail: input.email,
      secret: input.codeHashKey,
    });
    const now = new Date().toISOString();

    if (!matches) {
      await tx.login_codes.updateOne({
        select: { id: true },
        data: { attempts: token.attempts + 1 },
        where: { id: token.id },
      });
      return { kind: "invalid" };
    }

    await tx.login_codes.updateOne({
      select: { id: true },
      data: { consumed_at: now },
      where: { id: token.id },
    });
    return { kind: "valid" };
  });
}

async function findOrCreateUserByEmail(db: DbClient, email: string): Promise<AuthUser> {
  const select = {
    id: true,
    email: true,
    name: true,
    avatar_url: true,
    locale: true,
    timezone: true,
    country: true,
    currency: true,
  } as const;
  const existing = await db.users.findOne({ select, where: { email } });

  if (existing) {
    return toAuthUser(existing);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const created = await db.transaction(async (tx) => {
    const row = await tx.users.insertOne({
      select,
      data: {
        id,
        email,
        locale: "pt-BR",
        timezone: "America/Sao_Paulo",
        country: "BR",
        currency: "BRL",
        created_at: now,
        updated_at: now,
      },
    });
    await tx.auth_identities.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        user: { id },
        provider: "email",
        provider_user_id: email,
        email,
        email_verified: true,
        created_at: now,
        updated_at: now,
      },
    });
    return row;
  });

  return toAuthUser(created);
}

async function issueSession(
  db: DbClient,
  userId: string,
  deviceName?: string,
): Promise<{ familyId: string; refreshToken: string }> {
  const familyId = crypto.randomUUID();
  const refreshToken = generateRefreshToken();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.session_families.insertOne({
      select: { id: true },
      data: {
        id: familyId,
        user: { id: userId },
        device_name: deviceName,
        created_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      },
    });
    await tx.refresh_tokens.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        family: { id: familyId },
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
        created_at: now.toISOString(),
      },
    });
  });

  return { familyId, refreshToken };
}

async function rotateRefreshToken(
  db: DbClient,
  clearToken: string,
): Promise<RotateRefreshTokenOutcome> {
  return db.transaction(async (tx): Promise<RotateRefreshTokenOutcome> => {
    const token = await tx.refresh_tokens.findOne({
      select: {
        id: true,
        family_id: true,
        expires_at: true,
        consumed_at: true,
      },
      where: { token_hash: hashRefreshToken(clearToken) },
      lock: true,
    });

    if (!token) {
      return { kind: "invalid" };
    }

    const family = await tx.session_families.findOne({
      select: { id: true, user_id: true, revoked_at: true },
      where: { id: token.family_id },
      lock: true,
    });

    if (!family || family.revoked_at) {
      return { kind: "invalid" };
    }

    if (token.consumed_at) {
      await tx.session_families.updateOne({
        select: { id: true },
        data: { revoked_at: new Date().toISOString() },
        where: { id: family.id },
      });
      return { kind: "replayed" };
    }

    if (new Date(token.expires_at).getTime() <= Date.now()) {
      return { kind: "expired" };
    }

    const now = new Date();
    const refreshToken = generateRefreshToken();
    await tx.refresh_tokens.updateOne({
      select: { id: true },
      data: { consumed_at: now.toISOString() },
      where: { id: token.id },
    });
    await tx.refresh_tokens.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        family: { id: family.id },
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
        created_at: now.toISOString(),
      },
    });
    await tx.session_families.updateOne({
      select: { id: true },
      data: { last_seen_at: now.toISOString() },
      where: { id: family.id },
    });

    return {
      kind: "rotated",
      familyId: family.id,
      userId: family.user_id,
      refreshToken,
    };
  });
}

async function revokeFamilyByRefreshToken(db: DbClient, clearToken: string): Promise<void> {
  const token = await db.refresh_tokens.findOne({
    select: { family_id: true },
    where: { token_hash: hashRefreshToken(clearToken) },
  });

  if (token) {
    await db.session_families.updateOne({
      select: { id: true },
      data: { revoked_at: new Date().toISOString() },
      where: { id: token.family_id, revoked_at: { isNull: true } },
    });
  }
}

export function createAuthRepository(db: DbClient): AuthRepository & SessionRepository {
  return {
    replaceLoginCode: (input) => replaceLoginCode(db, input),
    consumeLoginCode: (input) => consumeLoginCode(db, input),
    findOrCreateUserByEmail: (email) => findOrCreateUserByEmail(db, email),
    issueSession: (userId, deviceName) => issueSession(db, userId, deviceName),
    rotateRefreshToken: (token) => rotateRefreshToken(db, token),
    revokeFamilyByRefreshToken: (token) => revokeFamilyByRefreshToken(db, token),
  };
}

export async function findAuthUserById(db: DbClient, id: string): Promise<AuthUser | undefined> {
  const row = await db.users.findOne({
    select: {
      id: true,
      email: true,
      name: true,
      avatar_url: true,
      locale: true,
      timezone: true,
      country: true,
      currency: true,
    },
    where: { id },
  });
  return row ? toAuthUser(row) : undefined;
}
