import type { DbClient } from "../database";
import { lockAccountReferences } from "../account/locking";
import { createAuthRepository } from "../repositories/auth-repository";
import type { OauthGrantCommit } from "./oauth-flow";
import { activateAppleCredential, claimAppleActivation } from "./apple-credentials";

export async function commitOauthIdentity(db: DbClient, input: OauthGrantCommit): Promise<void> {
  await db.transaction(async tx => {
    await lockAccountReferences(tx, "write");
    if (input.provider === "apple") {
      if (!input.identity.appleCredentialId) throw new Error("Apple credential journal is required");
      await claimAppleActivation(tx, input.identity.appleCredentialId);
    }
    const repo = createAuthRepository(tx), user = await repo.resolveUser(input);
    if (input.identity.appleCredentialId) await activateAppleCredential(tx, input.identity.appleCredentialId, user.id);
    await repo.createGrant({ clientChallenge: input.clientChallenge, expiresAt: input.expiresAt, grantHash: input.grantHash, userId: user.id });
  });
}
