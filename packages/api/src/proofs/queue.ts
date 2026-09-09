import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { String } from '@ez4/schema';
import type { Db, DbClient } from '../database';
import { PROOF_KEY, protectedObject } from './cleanup';
import { configuredProofStorage } from './configured-storage';
import type { ProofStorage } from './storage';

export declare class StorageMessage implements Queue.Message {
  objectKey: String.Max<200>;

  chargeId?: String.UUID;

  purpose: 'orphan' | 'temporary' | 'account';
}

export declare class StorageQueue extends Queue.Unordered<StorageMessage> {
  deadLetter: Queue.UseDeadLetter<{ maxAttempts: 5; retention: 20160 }>;

  backoff: Queue.UseBackoff<{ minDelay: 5; maxDelay: 300 }>;

  timeout: 120;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deleteStoredObject;
      concurrency: 2;
    }>
  ];

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PROOF_STORAGE_MODE: Environment.VariableOrValue<'PROOF_STORAGE_MODE', 'disabled'>;
    PROOF_S3_BUCKET: Environment.VariableOrValue<'PROOF_S3_BUCKET', 'disabled'>;
    PROOF_LOCAL_DIRECTORY: Environment.VariableOrValue<'PROOF_LOCAL_DIRECTORY', 'disabled'>;
    PROOF_LOCAL_BASE_URL: Environment.VariableOrValue<'PROOF_LOCAL_BASE_URL', 'disabled'>;
    PROOF_LOCAL_SECRET: Environment.VariableOrValue<'PROOF_LOCAL_SECRET', 'disabled'>;
  };
}

export type ProofDeletion = {
  message: StorageMessage;
  attempt: number;
  maxAttempts: number;
};

/**
 * Deletes one bucket object once nothing references it. There is no deletion journal:
 * idempotency comes from the storage itself, where removing an absent object succeeds.
 */
export async function deleteProofObject(
  db: DbClient,
  storage: ProofStorage,
  request: ProofDeletion,
  clock = Date.now
): Promise<'deleted' | 'skipped' | 'rejected'> {
  const { objectKey, chargeId, purpose } = request.message;

  if (!PROOF_KEY.test(objectKey)) {
    // A key this service never minted is poison, not a transient failure.
    console.error('Proof deletion rejected', { purpose, reason: 'invalid_key' });

    return 'rejected';
  }

  const guarded = await db.transaction(async (tx) => {
    if (chargeId) {
      // Best effort: an erased account leaves objects whose charge row is already gone.
      await tx.charges.findOne({ select: { id: true }, where: { id: chargeId }, lock: true });
    }

    return protectedObject(tx, objectKey, chargeId, clock());
  });

  if (guarded) {
    console.info('Proof deletion skipped', { purpose, reason: 'object_referenced_or_inflight' });

    return 'skipped';
  }

  try {
    await storage.delete(objectKey);
  } catch (error) {
    if (request.attempt >= request.maxAttempts) {
      // Last attempt: the message goes to the dead letter queue right after this throw.
      console.error('Proof deletion exhausted', { purpose, attempt: request.attempt });
    }

    throw error;
  }

  return 'deleted';
}

export async function deleteStoredObject(request: Queue.Incoming<StorageMessage>, context: Service.Context<StorageQueue>): Promise<void> {
  const { purpose } = request.message;

  if (context.variables.PROOF_STORAGE_MODE === 'disabled') {
    console.info('Proof deletion', { status: 'disabled', purpose });

    return;
  }

  const storage = configuredProofStorage(context.variables);

  const status = await deleteProofObject(context.db, storage, {
    message: request.message,
    attempt: request.attempt,
    maxAttempts: request.maxAttempts
  });

  console.info('Proof deletion', { purpose, status });
}
