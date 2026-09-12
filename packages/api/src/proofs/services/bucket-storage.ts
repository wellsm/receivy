import type { Client } from '@ez4/storage';
import type { ProofStorage } from './storage';

/**
 * The EZ4 bucket linked to the API is the only proof storage: S3 on a deployed stage, the emulator's
 * `.ez4/proof-files` under `serve --local`. Both sign write/read URLs on their own host, so the browser
 * and the app talk to the same origin the API already lives on locally.
 */
export function bucketProofStorage(bucket: Client): ProofStorage {
  return {
    uploadUrl: (key, mime) => bucket.getWriteUrl(key, { expiresIn: 300, contentType: mime }),
    read: (key) => bucket.read(key),
    downloadUrl: (key) => bucket.getReadUrl(key, { expiresIn: 60 }),

    // Deleting an object that is already gone must succeed: callers fire and forget.
    async delete(key) {
      if (await bucket.exists(key)) {
        await bucket.delete(key);
      }
    }
  };
}
