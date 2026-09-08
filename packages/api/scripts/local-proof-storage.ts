import { startLocalProofServer } from '../src/proofs/local-storage.ts';

if (process.env.APP_STAGE !== 'local' || process.env.PROOF_STORAGE_MODE !== 'local') throw new Error('Explicit local mode required.');
await startLocalProofServer({
  directory: process.env.PROOF_LOCAL_DIRECTORY ?? '',
  secret: process.env.PROOF_LOCAL_SECRET ?? '',
  origin: process.env.PROOF_WEB_ORIGIN ?? 'http://localhost:3000',
  port: Number(process.env.PROOF_LOCAL_PORT ?? '3736')
});
console.info('Local private proof storage ready on loopback.');
