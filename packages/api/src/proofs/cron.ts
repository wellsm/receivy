import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import { reconcileProofStorage } from './cleanup';
import { configuredProofStorage } from './configured-storage';
import type { StorageQueue } from './queue';

export declare class StorageCron extends Cron.Service {
  expression: 'cron(15 * * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof storageCronHandler;
    timeout: 300;
  }>;

  services: {
    db: Environment.Service<Db>;
    storageQueue: Environment.Service<StorageQueue>;
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

/** Only finds and enqueues candidates; `StorageQueue` performs every deletion. */
export async function storageCronHandler(_request: Cron.Incoming<null>, context: Service.Context<StorageCron>): Promise<void> {
  if (context.variables.PROOF_STORAGE_MODE === 'disabled') {
    console.info('Storage cron', { status: 'disabled' });

    return;
  }

  const storage = configuredProofStorage(context.variables);

  const result = await reconcileProofStorage(context.db, storage, (message) => context.storageQueue.sendMessage(message));

  // Counts only; never object keys or owners.
  console.info('Storage cron', result);
}
