import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { AuthUser } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { Db, DbClient } from '../../database';
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
};

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
    }
  };
}
