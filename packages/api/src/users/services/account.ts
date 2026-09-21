import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { type AuthUser, type ReminderConfig, type ReminderSettings, SYSTEM_REMINDER_CONFIG } from '@receivy/common';
import { parseReminderConfig, serializeReminderConfig } from '../../billings/utils/reminders';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { Db, DbClient } from '../../database';
import { WHATSAPP_AVAILABLE } from '../../notifications/services/planner';
import { bucketProofStorage } from '../../proofs/services/bucket-storage';
import type { AvatarFiles, ProofFiles } from '../../storage';
import { AccountRepository } from '../repositories/account';
import { AvatarRepository } from '../repositories/avatar';
import { normalizeProfile, type ProfileInput } from '../utils/profile';
import { eraseAccount } from './deletion';

export type AccountClient = {
  me(userId: string): Promise<{ user: AuthUser }>;
  updateProfile(userId: string, input: ProfileInput): Promise<{ user: AuthUser }>;
  erase(userId: string, confirmation: string): Promise<{ deleted: boolean }>;
  reminders(userId: string): Promise<ReminderSettings>;
  saveReminders(userId: string, config: ReminderConfig): Promise<ReminderSettings>;
  clearReminders(userId: string): Promise<ReminderSettings>;
};

/** What actually fires today, or the system default the account has not customised yet. */
async function reminderSettings(db: DbClient, userId: string): Promise<ReminderSettings> {
  const row = await AccountRepository.reminderConfig(db, userId);

  if (!row) {
    throw new HttpUnauthorizedError();
  }

  const config = parseReminderConfig(row.reminder_config);

  return { config: config ?? SYSTEM_REMINDER_CONFIG, inherited: config === null, whatsappAvailable: WHATSAPP_AVAILABLE };
}

async function saveReminders(db: DbClient, userId: string, input: ReminderConfig): Promise<ReminderSettings> {
  let json: string;

  try {
    json = serializeReminderConfig(input);
  } catch (error) {
    throw new HttpBadRequestError(error instanceof Error ? error.message : 'Lembretes inválidos.');
  }

  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.saveReminderConfig(tx, userId, json, now);
    await EventRepository.record(tx, { type: 'account.reminders_updated', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });
  });

  return reminderSettings(db, userId);
}

async function clearReminders(db: DbClient, userId: string): Promise<ReminderSettings> {
  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.saveReminderConfig(tx, userId, null, now);
    await EventRepository.record(tx, { type: 'account.reminders_cleared', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });
  });

  return reminderSettings(db, userId);
}

export declare class AccountService extends Factory.Service<AccountClient> {
  handler: typeof createService;

  services: {
    db: Environment.Service<Db>;
    avatarFiles: Environment.Service<AvatarFiles>;
    // Erasing an account still deletes the proof files the person sent.
    proofFiles: Environment.Service<ProofFiles>;
  };
}

/** Onboarding and later edits: the profile is validated, stored and logged in one transaction. */
export async function updateProfile(db: DbClient, userId: string, input: ProfileInput): Promise<AuthUser> {
  const profile = normalizeProfile(input);

  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, userId);

    const now = new Date().toISOString();

    await AccountRepository.saveProfile(tx, userId, profile, now);
    await EventRepository.record(tx, { type: 'account.profile_updated', eventableType: EventableType.Account, eventableId: userId, actorId: userId, at: now });

    return (await AccountRepository.authUser(tx, userId))!;
  });
}

export function createService({ db, avatarFiles, proofFiles }: Service.Context<AccountService>): AccountClient {
  return {
    me: async (userId) => {
      const user = await AccountRepository.authUser(db, userId);

      if (!user) {
        throw new HttpUnauthorizedError();
      }

      return AvatarRepository.sign(avatarFiles, { user });
    },
    updateProfile: async (userId, input) => AvatarRepository.sign(avatarFiles, { user: await updateProfile(db, userId, input) }),
    erase: async (userId, confirmation) => {
      const { objectKeys, ...result } = await eraseAccount(db, userId, confirmation);
      // The erasure is already committed; the files follow best-effort, nothing references them any more.
      const storage = bucketProofStorage(proofFiles);

      for (const key of objectKeys) {
        await storage.delete(key).catch(() => console.error('Account file deletion failed'));
      }

      return result;
    },
    reminders: (userId) => reminderSettings(db, userId),
    saveReminders: (userId, config) => saveReminders(db, userId, config),
    clearReminders: (userId) => clearReminders(db, userId)
  };
}
