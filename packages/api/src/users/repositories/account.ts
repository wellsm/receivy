import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import { type AuthUser, UserStatus } from '@receivy/common';
import type { PersonRow } from '../../contacts/utils/person';
import type { DbClient } from '../../database';
import { type AuthUserRow, toAuthUser } from '../utils/auth-user';
import type { Profile } from '../utils/profile';

const sqlNull = null as unknown as undefined;

export namespace AccountRepository {
  /** Whether the account exists and was not erased; `lock` takes its row for the caller's transaction. */
  export async function isLive(db: DbClient, id: string, lock = false): Promise<boolean> {
    const row = await db.users.findOne({ select: { id: true }, where: { id, deleted_at: { isNull: true } }, ...(lock ? { lock: true } : {}) });

    return !!row;
  }

  /** Who a live account is and whether its e-mail was confirmed; null once the account was erased. */
  export async function get(db: DbClient, id: string): Promise<{ id: string; name?: string; email?: string; verified_email?: string } | null> {
    const row = await db.users.findOne({
      select: { id: true, name: true, email: true, verified_email: true },
      where: { id, deleted_at: { isNull: true } }
    });

    return row ?? null;
  }

  /** How many of `ids` are placeholders: pending accounts nobody can sign into because they have no e-mail. */
  export async function countPlaceholders(db: DbClient, ids: string[]): Promise<number> {
    return db.users.count({ where: { id: { isIn: ids }, email: { isNull: true }, status: UserStatus.Pending } });
  }

  export async function timezone(db: DbClient, id: string): Promise<string> {
    const row = await db.users.findOne({ select: { timezone: true }, where: { id } });

    if (!row) {
      throw new HttpNotFoundError();
    }

    return row.timezone;
  }

  /** The person columns of one account, removed ones included; `lock` takes the row for the caller's transaction. */
  export async function person(db: DbClient, id: string, lock = false): Promise<PersonRow | null> {
    const row = await db.users.findOne({
      select: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true },
      where: { id },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  export async function byEmail(db: DbClient, email: string, lock = false): Promise<PersonRow | null> {
    const row = await db.users.findOne({
      select: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true },
      where: { email },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  /**
   * A pending account created on behalf of a person; a login with that e-mail later takes it over. Without an
   * e-mail nobody can find it: it stays its owner's placeholder until a guest is linked to it.
   */
  export async function insertPending(db: DbClient, input: { name: string; email?: string; now: string }): Promise<string> {
    const row = await db.users.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        ...(input.email ? { email: input.email } : {}),
        name: input.name,
        status: UserStatus.Pending,
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: input.now,
        updated_at: input.now
      }
    });

    return row.id;
  }

  /** Name, and e-mail when given, of a pending account; an active one owns both and is never renamed here. */
  export async function rename(db: DbClient, id: string, input: { name: string; email?: string }, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { name: input.name, ...(input.email ? { email: input.email } : {}), updated_at: now } });
  }

  export async function remove(db: DbClient, id: string): Promise<void> {
    await db.users.deleteOne({ where: { id } });
  }

  /** Takes the row lock of a live account; a deleted or unknown one answers 401, whoever asks. */
  export async function lock(db: DbClient, userId: string): Promise<void> {
    const user = await db.users.findOne({ select: { id: true }, where: { id: userId, deleted_at: { isNull: true } }, lock: true });

    if (!user) {
      throw new HttpUnauthorizedError();
    }
  }

  /** Onboarding is what turns a pending account (own login or someone's contact) into an active one. */
  export async function saveProfile(db: DbClient, id: string, profile: Profile, now: string): Promise<void> {
    await db.users.updateOne({
      where: { id },
      data: {
        name: profile.name,
        phone: profile.phone ?? sqlNull,
        status: UserStatus.Active,
        locale: profile.locale,
        timezone: profile.timezone,
        country: profile.country,
        updated_at: now
      }
    });
  }

  export async function reminderConfig(db: DbClient, id: string): Promise<{ reminder_config?: string } | null> {
    const row = await db.users.findOne({ select: { reminder_config: true }, where: { id, deleted_at: { isNull: true } } });

    return row ?? null;
  }

  export async function saveReminderConfig(db: DbClient, id: string, json: string | null, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { reminder_config: json ?? sqlNull, updated_at: now } });
  }

  export async function setEmailOptOut(db: DbClient, id: string, at: string | null, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { email_opt_out_at: at ?? sqlNull, updated_at: now } });
  }

  /** The live account as its own session reads it. */
  export async function authUser(db: DbClient, id: string): Promise<AuthUser | null> {
    const row = await db.users.findOne({
      select: { id: true, email: true, name: true, phone: true, avatar_url: true, avatar_updated_at: true, status: true, locale: true, timezone: true, country: true, currency: true },
      where: { id, deleted_at: { isNull: true } }
    });

    return row ? toAuthUser(row as AuthUserRow) : null;
  }

  /** The live account behind an e-mail, as a login reads it; `lock` takes the row for the caller's transaction. */
  export async function authUserByEmail(db: DbClient, email: string, lock = false): Promise<AuthUser | null> {
    const row = await db.users.findOne({
      select: { id: true, email: true, name: true, phone: true, avatar_url: true, avatar_updated_at: true, status: true, locale: true, timezone: true, country: true, currency: true },
      where: { email, deleted_at: { isNull: true } },
      ...(lock ? { lock: true } : {})
    });

    return row ? toAuthUser(row as AuthUserRow) : null;
  }

  /** A first login: the account starts pending, with the Brazilian defaults, until the profile is filled. */
  export async function insertAccount(db: DbClient, input: { id: string; email: string; name?: string; avatarUrl?: string; now: string }): Promise<AuthUser> {
    const row = await db.users.insertOne({
      select: { id: true, email: true, name: true, phone: true, avatar_url: true, avatar_updated_at: true, status: true, locale: true, timezone: true, country: true, currency: true },
      data: {
        id: input.id,
        email: input.email,
        ...(input.name ? { name: input.name } : {}),
        ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
        status: UserStatus.Pending,
        locale: 'pt-BR',
        timezone: 'America/Sao_Paulo',
        country: 'BR',
        currency: 'BRL',
        created_at: input.now,
        updated_at: input.now
      }
    });

    return toAuthUser(row as AuthUserRow);
  }

  /** A login through a verified channel confirms the address; a pending account created by a contact keeps its id. */
  export async function markEmailVerified(db: DbClient, id: string, email: string): Promise<void> {
    await db.users.updateOne({ where: { id, email, deleted_at: { isNull: true } }, data: { verified_email: email } });
  }

  /** When the live account last changed its photo; null when there is no such account. */
  export async function avatarUpdatedAt(db: DbClient, id: string): Promise<{ avatarUpdatedAt: string | null } | null> {
    const row = await db.users.findOne({ select: { avatar_updated_at: true }, where: { id, deleted_at: { isNull: true } } });

    return row ? { avatarUpdatedAt: row.avatar_updated_at ?? null } : null;
  }

  export async function touchAvatar(db: DbClient, id: string, now: string): Promise<void> {
    await db.users.updateOne({ where: { id }, data: { avatar_updated_at: now, updated_at: now } });
  }

  /** The row an erasure starts from, taken under lock: removed accounts included, so a retry answers the same. */
  export async function forErasure(db: DbClient, id: string): Promise<{ id: string; email?: string; deleted_at?: string } | null> {
    const row = await db.users.findOne({ select: { id: true, email: true, deleted_at: true }, where: { id }, lock: true });

    return row ?? null;
  }

  /** Everything personal goes; the row stays so the other side of every charge still reads. */
  export async function erase(db: DbClient, id: string, now: string): Promise<void> {
    await db.users.updateOne({
      where: { id },
      data: {
        email: `${id}@deleted.invalid`,
        verified_email: sqlNull,
        name: 'Conta excluída',
        phone: sqlNull,
        avatar_url: sqlNull,
        avatar_updated_at: sqlNull,
        reminder_config: sqlNull,
        email_opt_out_at: sqlNull,
        whatsapp_opt_out_at: sqlNull,
        status: UserStatus.Removed,
        timezone: 'UTC',
        deleted_at: now,
        updated_at: now
      }
    });
  }
}
