import { localProofStorage } from "./local-storage";
import { s3ProofStorage } from "./storage";
export function configuredProofStorage(env: Record<string, string | undefined>) {
  if (env.PROOF_STORAGE_MODE === "local") {
    if (env.APP_STAGE !== "local" && env.APP_STAGE !== "test") throw new Error("Local storage is forbidden outside explicit local/test stages.");
    return localProofStorage({ directory: env.PROOF_LOCAL_DIRECTORY ?? "", baseUrl: env.PROOF_LOCAL_BASE_URL ?? "", secret: env.PROOF_LOCAL_SECRET ?? "" });
  }
  if (env.PROOF_STORAGE_MODE === "s3") {
    const bucket = env.PROOF_S3_BUCKET ?? "";
    const prefix = `${env.APP_STAGE}-receivy-proof-files-`;
    if (!env.APP_STAGE || !bucket.startsWith(prefix) || !/^[a-z0-9-]{3,63}$/.test(bucket)) throw new Error("Configure the exact linked ProofFiles bucket name from EZ4 output.");
    return s3ProofStorage(bucket);
  }
  throw new Error("Proof storage is not configured; no fallback is allowed.");
}
