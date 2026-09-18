import type { Service } from '@ez4/common';
import { type Bucket, BucketEventType } from '@ez4/storage';
import type { ProofFiles } from '../../storage';
import { receiveProofObject } from '../services/proof';
import { bucketProofStorage } from '../services/bucket-storage';

/** The bucket tells the API a file landed; the reserved slot on the charge decides whether it stays. */
export async function proofObjectEvent(event: Bucket.ObjectEvent, { db, proofFiles }: Service.Context<ProofFiles>): Promise<void> {
  if (event.eventType !== BucketEventType.Create) {
    return;
  }

  const outcome = await receiveProofObject(db, bucketProofStorage(proofFiles), event.objectKey);

  console.info('Proof object', { key: event.objectKey, outcome });
}
