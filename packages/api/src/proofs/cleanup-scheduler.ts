import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import type { ProofFiles } from '../storage';
import { drainStorageDeletions, reconcileProofStorage } from './cleanup';
import { configuredProofStorage } from './configured-storage';
export declare class ProofCleanupScheduler extends Cron.Service {
  expression: 'cron(15 * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{
    handler: typeof proofCleanupJobHandler;
    timeout: 300;
  }>;
  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
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
export async function proofCleanupJobHandler(
  _request: Cron.Incoming<null>,
  context: Service.Context<ProofCleanupScheduler>
): Promise<void> {
  if (context.variables.PROOF_STORAGE_MODE === 'disabled') {
    console.info('Proof cleanup', { status: 'disabled' });
    return;
  }
  const storage = configuredProofStorage(context.variables);
  const reconciliation = await reconcileProofStorage(context.db, storage);
  const deletions = await drainStorageDeletions(context.db, storage);
  console.info('Proof cleanup', { ...reconciliation, ...deletions });
}
