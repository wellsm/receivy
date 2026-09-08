import type { AuthUser } from '@receivy/common';
import { lockAccountReferences } from '../account/locking';
import { disableSessionDevices, revokeSession } from '../account/sessions';
import { canAttemptEmailCode, createEmailCodeHash, verifyEmailCodeHash } from '../auth/code';
import type { AuthRepository, LoginCodeOutcome } from '../auth/email-login';
import type { OauthFlowRepository } from '../auth/oauth-flow';
import { OauthFlowError } from '../auth/oauth-flow';
import type { RotateRefreshTokenOutcome, SessionRepository } from '../auth/refresh-session';
import { generateRefreshToken, hashRefreshToken } from '../auth/session';
import type { DbClient } from '../database';
import { linkVerifiedPeople } from '../people/repository';

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const LOGIN_CODE_SELECT = {
  id: true,
  code_hash: true,
  attempts: true,
  expires_at: true,
  consumed_at: true,
  created_at: true
} as const;

function toAuthUser(row: {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  locale: 'pt-BR';
  timezone: string;
  country: 'BR';
  currency: 'BRL';
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    avatarUrl: row.avatar_url ?? null,
    locale: row.locale,
    timezone: row.timezone,
    country: row.country,
    currency: row.currency
  };
}

async function replaceLoginCode(db: DbClient, input: { code: string; codeHashKey: string; email: string }): Promise<{ accepted: boolean }> {
  return db.transaction(async (tx): Promise<{ accepted: boolean }> => {
    await lockAccountReferences(tx, 'write');
    // No row exists on the first request: serialize by keyed email before SELECT/INSERT.
    await tx.rawQuery('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', {
      key: createEmailCodeHash({ code: 'otp-request-lock', normalizedEmail: input.email, secret: input.codeHashKey })
    });
    const previous = await tx.login_codes.findOne({
      select: LOGIN_CODE_SELECT,
      where: { email: input.email },
      lock: true
    });
    const now = new Date();

    if (previous && now.getTime() - new Date(previous.created_at).getTime() < CODE_COOLDOWN_MS) {
      return { accepted: false };
    }

    const data = {
      code_hash: createEmailCodeHash({
        code: input.code,
        normalizedEmail: input.email,
        secret: input.codeHashKey
      }),
      attempts: 0,
      expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      consumed_at: null as unknown as string | undefined,
      created_at: now.toISOString()
    };

    if (previous) {
      await tx.login_codes.updateOne({
        select: { id: true },
        data,
        where: { id: previous.id }
      });
    } else {
      await tx.login_codes.insertOne({
        select: { id: true },
        data: { id: crypto.randomUUID(), email: input.email, ...data }
      });
    }

    return { accepted: true };
  });
}

async function consumeLoginCode(db: DbClient, input: { code: string; codeHashKey: string; email: string }): Promise<LoginCodeOutcome> {
  return db.transaction(async (tx): Promise<LoginCodeOutcome> => {
    const token = await tx.login_codes.findOne({
      select: LOGIN_CODE_SELECT,
      where: { email: input.email },
      lock: true
    });

    if (!token) {
      return { kind: 'invalid' };
    }

    const usable = canAttemptEmailCode({
      attempts: token.attempts,
      consumedAt: token.consumed_at ? new Date(token.consumed_at) : null,
      expiresAt: new Date(token.expires_at)
    });

    if (!usable) {
      return {
        kind: token.attempts >= 5 ? 'exhausted' : 'expired'
      };
    }

    const matches = verifyEmailCodeHash({
      code: input.code,
      codeHash: token.code_hash,
      normalizedEmail: input.email,
      secret: input.codeHashKey
    });
    const now = new Date().toISOString();

    if (!matches) {
      await tx.login_codes.updateOne({
        select: { id: true },
        data: { attempts: token.attempts + 1 },
        where: { id: token.id }
      });
      return { kind: 'invalid' };
    }

    await tx.login_codes.updateOne({
      select: { id: true },
      data: { consumed_at: now },
      where: { id: token.id }
    });
    return { kind: 'valid' };
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
    currency: true
  } as const;
  const existing = await db.users.findOne({ select, where: { email, deleted_at: { isNull: true } } });

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
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: now,
        updated_at: now
      }
    });
    await tx.auth_identities.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        user: { id },
        provider: 'email',
        provider_user_id: email,
        email,
        email_verified: true,
        created_at: now,
        updated_at: now
      }
    });
    return row;
  });

  return toAuthUser(created);
}

async function issueSession(db: DbClient, userId: string, deviceName?: string): Promise<{ familyId: string; refreshToken: string }> {
  const familyId = crypto.randomUUID();
  const refreshToken = generateRefreshToken();
  const now = new Date();

  await db.transaction(async (tx) => {
    if (!(await tx.users.findOne({ select: { id: true }, where: { id: userId, deleted_at: { isNull: true } }, lock: true })))
      throw new Error('Account unavailable');
    await tx.session_families.insertOne({
      select: { id: true },
      data: {
        id: familyId,
        user: { id: userId },
        device_name: deviceName,
        created_at: now.toISOString(),
        last_seen_at: now.toISOString()
      }
    });
    await tx.refresh_tokens.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        family: { id: familyId },
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
        created_at: now.toISOString()
      }
    });
  });

  return { familyId, refreshToken };
}

async function createOauthAttempt(db: DbClient, input: Parameters<OauthFlowRepository['createAttempt']>[0]): Promise<void> {
  const now = new Date().toISOString();
  await db.oauth_attempts.insertOne({
    select: { id: true },
    data: {
      id: crypto.randomUUID(),
      provider: input.provider,
      state_hash: input.stateHash,
      client_challenge: input.clientChallenge,
      destination: input.destination,
      code_verifier: input.codeVerifier,
      nonce: input.nonce,
      expires_at: input.expiresAt.toISOString(),
      created_at: now
    }
  });
}

async function consumeOauthAttempt(
  db: DbClient,
  input: Parameters<OauthFlowRepository['consumeAttempt']>[0]
): ReturnType<OauthFlowRepository['consumeAttempt']> {
  return db.transaction(async (tx) => {
    const attempt = await tx.oauth_attempts.findOne({
      select: {
        id: true,
        destination: true,
        code_verifier: true,
        client_challenge: true,
        nonce: true,
        expires_at: true,
        consumed_at: true
      },
      where: { provider: input.provider, state_hash: input.stateHash },
      lock: true
    });
    if (!attempt || attempt.consumed_at || new Date(attempt.expires_at).getTime() <= Date.now()) {
      return null;
    }

    await tx.oauth_attempts.updateOne({
      select: { id: true },
      data: { consumed_at: new Date().toISOString() },
      where: { id: attempt.id }
    });
    return {
      destination: attempt.destination,
      codeVerifier: attempt.code_verifier,
      clientChallenge: attempt.client_challenge,
      nonce: attempt.nonce
    };
  });
}

async function resolveOauthUser(
  db: DbClient,
  input: Parameters<OauthFlowRepository['resolveUser']>[0]
): ReturnType<OauthFlowRepository['resolveUser']> {
  const select = {
    id: true,
    email: true,
    name: true,
    avatar_url: true,
    locale: true,
    timezone: true,
    country: true,
    currency: true
  } as const;

  return db.transaction(async (tx) => {
    const existingIdentity = await tx.auth_identities.findOne({
      select: { user_id: true },
      where: {
        provider: input.provider,
        provider_user_id: input.identity.subject
      },
      lock: true
    });
    if (existingIdentity) {
      const existingUser = await tx.users.findOne({
        select,
        where: { id: existingIdentity.user_id, deleted_at: { isNull: true } }
      });
      if (!existingUser) {
        throw new Error('OAuth identity references a missing user');
      }
      return toAuthUser(existingUser);
    }

    let account = await tx.users.findOne({
      select,
      where: { email: input.identity.email, deleted_at: { isNull: true } },
      lock: true
    });
    // Google does not vouch for continued ownership of third-party email inboxes.
    // An established provider subject may log in above; linking a new subject
    // to an existing email account requires authoritative email ownership.
    if (account && !input.identity.emailAuthoritative) {
      throw new OauthFlowError('EMAIL_LOGIN_REQUIRED');
    }
    const now = new Date().toISOString();
    if (!account) {
      account = await tx.users.insertOne({
        select,
        data: {
          id: crypto.randomUUID(),
          email: input.identity.email,
          name: input.identity.name,
          avatar_url: input.identity.picture,
          locale: 'pt-BR',
          timezone: 'America/Sao_Paulo',
          country: 'BR',
          currency: 'BRL',
          created_at: now,
          updated_at: now
        }
      });
    }

    await tx.auth_identities.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        user: { id: account.id },
        provider: input.provider,
        provider_user_id: input.identity.subject,
        email: input.identity.email,
        email_verified: true,
        created_at: now,
        updated_at: now
      }
    });
    return toAuthUser(account);
  });
}

async function createOauthGrant(db: DbClient, input: Parameters<OauthFlowRepository['createGrant']>[0]): Promise<void> {
  await db.oauth_grants.insertOne({
    select: { id: true },
    data: {
      id: crypto.randomUUID(),
      user: { id: input.userId },
      grant_hash: input.grantHash,
      client_challenge: input.clientChallenge,
      expires_at: input.expiresAt.toISOString(),
      created_at: new Date().toISOString()
    }
  });
}

async function consumeOauthGrant(
  db: DbClient,
  grantHash: string,
  clientChallenge: string
): ReturnType<OauthFlowRepository['consumeGrant']> {
  return db.transaction(async (tx) => {
    const grant = await tx.oauth_grants.findOne({
      select: { id: true, user_id: true, expires_at: true, consumed_at: true },
      where: { grant_hash: grantHash, client_challenge: clientChallenge },
      lock: true
    });
    if (!grant || grant.consumed_at || new Date(grant.expires_at).getTime() <= Date.now()) {
      return null;
    }

    await tx.oauth_grants.updateOne({
      select: { id: true },
      data: { consumed_at: new Date().toISOString() },
      where: { id: grant.id }
    });
    const account = await tx.users.findOne({
      select: {
        id: true,
        email: true,
        name: true,
        avatar_url: true,
        locale: true,
        timezone: true,
        country: true,
        currency: true
      },
      where: { id: grant.user_id, deleted_at: { isNull: true } }
    });
    return account ? toAuthUser(account) : null;
  });
}

async function rotateRefreshToken(db: DbClient, clearToken: string): Promise<RotateRefreshTokenOutcome> {
  return db.transaction(async (tx): Promise<RotateRefreshTokenOutcome> => {
    let token = await tx.refresh_tokens.findOne({
      select: {
        id: true,
        family_id: true,
        expires_at: true,
        consumed_at: true
      },
      where: { token_hash: hashRefreshToken(clearToken) }
    });

    if (!token) {
      return { kind: 'invalid' };
    }

    // All account/session/device mutations serialize user -> family -> token.
    // The first token read is only a hint; reread it under lock below.
    const hint = await tx.session_families.findOne({ select: { user_id: true }, where: { id: token.family_id } });
    if (!hint || !(await tx.users.findOne({ select: { id: true }, where: { id: hint.user_id, deleted_at: { isNull: true } }, lock: true })))
      return { kind: 'invalid' };

    const family = await tx.session_families.findOne({
      select: { id: true, user_id: true, revoked_at: true },
      where: { id: token.family_id },
      lock: true
    });

    if (!family || family.revoked_at) {
      return { kind: 'invalid' };
    }
    token = await tx.refresh_tokens.findOne({
      select: { id: true, family_id: true, expires_at: true, consumed_at: true },
      where: { id: token.id },
      lock: true
    });
    if (!token) return { kind: 'invalid' };

    if (token.consumed_at) {
      await tx.session_families.updateOne({
        select: { id: true },
        data: { revoked_at: new Date().toISOString() },
        where: { id: family.id }
      });
      await disableSessionDevices(tx, family.user_id, family.id);
      return { kind: 'replayed' };
    }

    if (new Date(token.expires_at).getTime() <= Date.now()) {
      return { kind: 'expired' };
    }

    const now = new Date();
    const refreshToken = generateRefreshToken();
    await tx.refresh_tokens.updateOne({
      select: { id: true },
      data: { consumed_at: now.toISOString() },
      where: { id: token.id }
    });
    await tx.refresh_tokens.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        family: { id: family.id },
        token_hash: hashRefreshToken(refreshToken),
        expires_at: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
        created_at: now.toISOString()
      }
    });
    await tx.session_families.updateOne({
      select: { id: true },
      data: { last_seen_at: now.toISOString() },
      where: { id: family.id }
    });

    return {
      kind: 'rotated',
      familyId: family.id,
      userId: family.user_id,
      refreshToken
    };
  });
}

async function revokeFamilyByRefreshToken(db: DbClient, clearToken: string): Promise<void> {
  const token = await db.refresh_tokens.findOne({
    select: { family_id: true },
    where: { token_hash: hashRefreshToken(clearToken) }
  });

  if (token) {
    const family = await db.session_families.findOne({ select: { user_id: true }, where: { id: token.family_id } });
    if (family) await revokeSession(db, family.user_id, token.family_id);
  }
}

export function createAuthRepository(db: DbClient): AuthRepository & SessionRepository & OauthFlowRepository {
  return {
    replaceLoginCode: (input) => replaceLoginCode(db, input),
    consumeLoginCode: (input) => consumeLoginCode(db, input),
    findOrCreateUserByEmail: async (email) => {
      const user = await findOrCreateUserByEmail(db, email);
      await linkVerifiedPeople(db, user.id, email);
      return user;
    },
    issueSession: (userId, deviceName) => issueSession(db, userId, deviceName),
    rotateRefreshToken: (token) => rotateRefreshToken(db, token),
    revokeFamilyByRefreshToken: (token) => revokeFamilyByRefreshToken(db, token),
    createAttempt: (input) => createOauthAttempt(db, input),
    consumeAttempt: (input) => consumeOauthAttempt(db, input),
    resolveUser: async (input) => {
      const user = await resolveOauthUser(db, input);
      if (input.identity.emailAuthoritative && user.email === input.identity.email) {
        await linkVerifiedPeople(db, user.id, user.email);
      }
      return user;
    },
    createGrant: (input) => createOauthGrant(db, input),
    consumeGrant: (grantHash, clientChallenge) => consumeOauthGrant(db, grantHash, clientChallenge)
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
      currency: true
    },
    where: { id, deleted_at: { isNull: true } }
  });
  return row ? toAuthUser(row) : undefined;
}
