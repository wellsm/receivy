import type { Environment, Service } from '@ez4/common';
import type { Client, Cron } from '@ez4/scheduler';
import type { String } from '@ez4/schema';
import type { Db } from '../../database';
import type { ProofFiles } from '../../storage';
import { expireProofUpload } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';

export type UploadExpirySchedule = { chargeId: String.UUID; key: String.Max<300> };

export type UploadExpiryClient = Pick<Client<UploadExpirySchedule>, 'setEvent' | 'deleteEvent'>;

/**
 * `charge:<id>:upload-expiry`: a reserved upload slot nobody filled is released five minutes later,
 * and whatever bytes did land under that key are dropped. Armed when the slot is reserved.
 */
export declare class UploadExpiryScheduler extends Cron.Service<UploadExpirySchedule> {
  group: 'upload-expiry';

  expression: 'dynamic';

  maxRetries: 3;

  target: Cron.UseTarget<{
    handler: typeof handler;
    timeout: 60;
  }>;

  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
  };
}

export const uploadExpiryIdentifier = (chargeId: string) => `charge:${chargeId}:upload-expiry`;

export async function handler(
  request: Cron.Incoming<UploadExpirySchedule>,
  context: Service.Context<UploadExpiryScheduler>
): Promise<void> {
  const { chargeId, key } = request.event;
  const released = await expireProofUpload(context.db, bucketProofStorage(context.proofFiles), chargeId, key);

  console.info('Upload expiry', { chargeId, released });
}
