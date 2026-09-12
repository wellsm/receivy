import type { ProofMime } from './validation';

/** The bucket as the proof code sees it; `bucket-storage.ts` binds it to the EZ4 client. */
export interface ProofStorage {
  uploadUrl(key: string, mime: ProofMime, size: number): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  downloadUrl(key: string, mime: ProofMime): Promise<string>;
}
