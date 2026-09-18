import { HttpForbiddenError } from '@ez4/gateway';
import { AuthProvider, type AuthUser } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { DeviceRepository } from '../../notifications/repositories/device';
import { AccountRepository } from '../repositories/account';
import { AuthRepository } from '../repositories/auth';
import { SessionRepository } from '../repositories/sessions';
import { canAttemptEmailCode, createEmailCodeHash, verifyEmailCodeHash } from './code';
import type { AuthRepository as EmailLoginStore, LoginCodeOutcome } from './email-login';
import { OauthProvider } from './oauth';
import { ErrorCode, OauthFlowError, type OauthFlowRepository } from './oauth-flow';
import type { SessionRepository as RefreshSessionStore, RotateRefreshTokenOutcome } from './refresh-session';
import { generateRefreshToken, hashRefreshToken } from './session';

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How long a consumed refresh token is still tolerated. Concurrent clients (browser tabs sharing one
 * cookie jar, a middleware hit by parallel requests) can present the same token before the winner's
 * rotation reaches them: inside this window the loser is told to retry with the pair it now holds,
 * and no token is ever issued for it. A reuse after the window is a replay and revokes the family.
 */
const REFRESH_GRACE_MS = 30 * 1000;

/** What the login flows read and write; one adapter over the transaction they run in. */
export type AuthStore = EmailLoginStore & RefreshSessionStore & OauthFlowRepository;

/** Identity rows share the provider column with e-mail logins, so the OAuth provider maps onto the wider list. */
function identityProvider(provider: OauthProvider): AuthProvider {
  if (provider === OauthProvider.Google) {
    return AuthProvider.Google;
  }

  return AuthProvider.Apple;
}

/** A new code for the address, unless one went out in the last minute. */
export async function replaceLoginCode(db: DbClient, input: { code: string; codeHashKey: string; email: string }): Promise<{ accepted: boolean }> {
  return db.transaction(async (tx) => {
    await AuthRepository.lockEmail(tx, createEmailCodeHash({ code: 'otp-request-lock', normalizedEmail: input.email, secret: input.codeHashKey }));

    const previous = await AuthRepository.loginCode(tx, input.email);
    const now = new Date();

    if (previous && now.getTime() - new Date(previous.created_at).getTime() < CODE_COOLDOWN_MS) {
      return { accepted: false };
    }

    const code = {
      codeHash: createEmailCodeHash({ code: input.code, normalizedEmail: input.email, secret: input.codeHashKey }),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      now: now.toISOString()
    };

    if (previous) {
      await AuthRepository.replaceLoginCode(tx, previous.id, code);
    } else {
      await AuthRepository.insertLoginCode(tx, { email: input.email, ...code });
    }

    return { accepted: true };
  });
}

/** One try against the stored code: a miss counts, a hit consumes it. */
export async function consumeLoginCode(db: DbClient, input: { code: string; codeHashKey: string; email: string }): Promise<LoginCodeOutcome> {
  return db.transaction(async (tx): Promise<LoginCodeOutcome> => {
    const token = await AuthRepository.loginCode(tx, input.email);

    if (!token) {
      return { kind: 'invalid' };
    }

    const usable = canAttemptEmailCode({
      attempts: token.attempts,
      consumedAt: token.consumed_at ? new Date(token.consumed_at) : null,
      expiresAt: new Date(token.expires_at)
    });

    if (!usable) {
      return { kind: token.attempts >= 5 ? 'exhausted' : 'expired' };
    }

    const matches = verifyEmailCodeHash({ code: input.code, codeHash: token.code_hash, normalizedEmail: input.email, secret: input.codeHashKey });

    if (!matches) {
      await AuthRepository.countLoginAttempt(tx, token.id, token.attempts + 1);

      return { kind: 'invalid' };
    }

    await AuthRepository.consumeLoginCode(tx, token.id, new Date().toISOString());

    return { kind: 'valid' };
  });
}

/** The account behind a confirmed e-mail, created on the first login with its e-mail identity. */
export async function findOrCreateUserByEmail(db: DbClient, email: string): Promise<AuthUser> {
  const existing = await AccountRepository.authUserByEmail(db, email);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  return db.transaction(async (tx) => {
    const user = await AccountRepository.insertAccount(tx, { id, email, now });

    await AuthRepository.insertIdentity(tx, { userId: id, provider: AuthProvider.Email, subject: email, email, now });

    return user;
  });
}

/** A new session family with its first refresh token. */
export async function issueSession(db: DbClient, userId: string, deviceName?: string): Promise<{ familyId: string; refreshToken: string }> {
  const familyId = crypto.randomUUID();
  const refreshToken = generateRefreshToken();
  const now = new Date();

  await db.transaction(async (tx) => {
    if (!(await AccountRepository.isLive(tx, userId, true))) {
      throw new Error('Account unavailable');
    }

    await SessionRepository.insertFamily(tx, { id: familyId, userId, deviceName, now: now.toISOString() });
    await SessionRepository.insertRefreshToken(tx, {
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
      now: now.toISOString()
    });
  });

  return { familyId, refreshToken };
}

async function consumeOauthAttempt(db: DbClient, input: Parameters<OauthFlowRepository['consumeAttempt']>[0]): ReturnType<OauthFlowRepository['consumeAttempt']> {
  return db.transaction(async (tx) => {
    const attempt = await AuthRepository.attempt(tx, input.provider, input.stateHash);

    if (!attempt || attempt.consumed_at || new Date(attempt.expires_at).getTime() <= Date.now()) {
      return null;
    }

    await AuthRepository.consumeAttempt(tx, attempt.id, new Date().toISOString());

    return { destination: attempt.destination, codeVerifier: attempt.code_verifier, clientChallenge: attempt.client_challenge, nonce: attempt.nonce };
  });
}

/** The account a provider identity signs into: the linked one, the one with that e-mail, or a new one. */
export async function resolveOauthUser(db: DbClient, input: Parameters<OauthFlowRepository['resolveUser']>[0]): Promise<AuthUser> {
  const provider = identityProvider(input.provider);

  return db.transaction(async (tx) => {
    const linkedId = await AuthRepository.identityOwner(tx, provider, input.identity.subject, true);

    if (linkedId) {
      const linked = await AccountRepository.authUser(tx, linkedId);

      if (!linked) {
        throw new Error('OAuth identity references a missing user');
      }

      return linked;
    }

    const account = await AccountRepository.authUserByEmail(tx, input.identity.email, true);

    // Google does not vouch for continued ownership of third-party email inboxes. An established provider
    // subject may log in above; linking a new subject to an existing email account requires authoritative
    // email ownership.
    if (account && !input.identity.emailAuthoritative) {
      throw new OauthFlowError(ErrorCode.EmailLoginRequired);
    }

    const now = new Date().toISOString();
    const user =
      account ??
      (await AccountRepository.insertAccount(tx, {
        id: crypto.randomUUID(),
        email: input.identity.email,
        name: input.identity.name,
        avatarUrl: input.identity.picture,
        now
      }));

    await AuthRepository.insertIdentity(tx, { userId: user.id, provider, subject: input.identity.subject, email: input.identity.email, now });

    return user;
  });
}

async function consumeOauthGrant(db: DbClient, grantHash: string, clientChallenge: string): Promise<AuthUser | null> {
  return db.transaction(async (tx) => {
    const grant = await AuthRepository.grant(tx, grantHash, clientChallenge);

    if (!grant || grant.consumed_at || new Date(grant.expires_at).getTime() <= Date.now()) {
      return null;
    }

    await AuthRepository.consumeGrant(tx, grant.id, new Date().toISOString());

    return AccountRepository.authUser(tx, grant.user_id);
  });
}

/** Ends one session family of the person; devices registered under it go quiet. */
export async function revokeFamily(db: DbClient, userId: string, familyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // The account row is taken first, erased or not: a logout after an erasure still ends the family quietly.
    await AccountRepository.person(tx, userId, true);

    const family = await SessionRepository.family(tx, familyId, true);

    if (!family || family.user_id !== userId) {
      throw new HttpForbiddenError();
    }

    const now = new Date().toISOString();

    await SessionRepository.revokeFamily(tx, familyId, now);
    await DeviceRepository.disableOf(tx, userId, familyId, now);
    await EventRepository.record(tx, {
      type: 'account.session_revoked',
      eventableType: EventableType.Account,
      eventableId: userId,
      actorId: userId,
      payload: { familyId },
      at: now
    });
  });
}

/** Every account, session and device mutation serializes user -> family -> token. */
export async function rotateRefreshToken(db: DbClient, clearToken: string): Promise<RotateRefreshTokenOutcome> {
  return db.transaction(async (tx): Promise<RotateRefreshTokenOutcome> => {
    // The first token read is only a hint; it is reread under lock below.
    const hint = await SessionRepository.refreshToken(tx, hashRefreshToken(clearToken));

    if (!hint) {
      return { kind: 'invalid' };
    }

    const owner = await SessionRepository.family(tx, hint.family_id);

    if (!owner || !(await AccountRepository.isLive(tx, owner.user_id, true))) {
      return { kind: 'invalid' };
    }

    const family = await SessionRepository.family(tx, hint.family_id, true);

    if (!family || family.revoked_at) {
      return { kind: 'invalid' };
    }

    const token = await SessionRepository.refreshTokenById(tx, hint.id, true);

    if (!token) {
      return { kind: 'invalid' };
    }

    if (token.consumed_at) {
      if (Date.now() - new Date(token.consumed_at).getTime() <= REFRESH_GRACE_MS) {
        return { kind: 'stale' };
      }

      const now = new Date().toISOString();

      await SessionRepository.revokeFamily(tx, family.id, now);
      await DeviceRepository.disableOf(tx, family.user_id, family.id, now);

      return { kind: 'replayed' };
    }

    if (new Date(token.expires_at).getTime() <= Date.now()) {
      return { kind: 'expired' };
    }

    const now = new Date();
    const refreshToken = generateRefreshToken();

    await SessionRepository.consumeRefreshToken(tx, token.id, now.toISOString());
    await SessionRepository.insertRefreshToken(tx, {
      familyId: family.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
      now: now.toISOString()
    });
    await SessionRepository.touchFamily(tx, family.id, now.toISOString());

    return { kind: 'rotated', familyId: family.id, userId: family.user_id, refreshToken };
  });
}

/** Logout: the family behind the refresh token ends, whoever presents it. */
export async function revokeFamilyByRefreshToken(db: DbClient, clearToken: string): Promise<void> {
  const token = await SessionRepository.refreshToken(db, hashRefreshToken(clearToken));

  if (!token) {
    return;
  }

  const family = await SessionRepository.family(db, token.family_id);

  if (family) {
    await revokeFamily(db, family.user_id, token.family_id);
  }
}

/** The login flows' view of the database, bound to `db` (a client or the transaction the flow runs in). */
export function authStore(db: DbClient): AuthStore {
  return {
    replaceLoginCode: (input) => replaceLoginCode(db, input),
    consumeLoginCode: (input) => consumeLoginCode(db, input),
    findOrCreateUserByEmail: async (email) => {
      const user = await findOrCreateUserByEmail(db, email);

      await AccountRepository.markEmailVerified(db, user.id, email);

      return user;
    },
    issueSession: (userId, deviceName) => issueSession(db, userId, deviceName),
    rotateRefreshToken: (token) => rotateRefreshToken(db, token),
    revokeFamilyByRefreshToken: (token) => revokeFamilyByRefreshToken(db, token),
    createAttempt: (input) =>
      AuthRepository.insertAttempt(db, {
        provider: input.provider,
        stateHash: input.stateHash,
        clientChallenge: input.clientChallenge,
        destination: input.destination,
        codeVerifier: input.codeVerifier,
        nonce: input.nonce,
        expiresAt: input.expiresAt.toISOString(),
        now: new Date().toISOString()
      }),
    consumeAttempt: (input) => consumeOauthAttempt(db, input),
    resolveUser: async (input) => {
      const user = await resolveOauthUser(db, input);

      if (input.identity.emailAuthoritative && user.email === input.identity.email) {
        await AccountRepository.markEmailVerified(db, user.id, user.email);
      }

      return user;
    },
    createGrant: (input) =>
      AuthRepository.insertGrant(db, {
        userId: input.userId,
        grantHash: input.grantHash,
        clientChallenge: input.clientChallenge,
        expiresAt: input.expiresAt.toISOString(),
        now: new Date().toISOString()
      }),
    consumeGrant: (grantHash, clientChallenge) => consumeOauthGrant(db, grantHash, clientChallenge)
  };
}
