import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import { bucketProofStorage } from '../../proofs/services/bucket-storage';
import type { UserProvider } from '../provider';
import { eraseAccount } from '../repositories/account';

declare class DeleteRequest implements Http.Request {
  identity: SessionIdentity;
  body: { confirmation: String.Max<20> };
}

declare class DeleteResponse implements Http.Response {
  status: 200;
  body: { deleted: boolean };
}

export async function deleteHandler(request: DeleteRequest, context: Service.Context<UserProvider>): Promise<DeleteResponse> {
  const { objectKeys, ...body } = await eraseAccount(context.db, request.identity.userId, request.body.confirmation);
  // The erasure is already committed; the files follow best-effort, nothing references them any more.
  const storage = bucketProofStorage(context.proofFiles);

  for (const key of objectKeys) {
    await storage.delete(key).catch(() => console.error('Account file deletion failed'));
  }

  return { status: 200, body };
}
