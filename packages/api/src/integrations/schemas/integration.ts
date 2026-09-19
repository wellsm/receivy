import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PaymentProvider } from '@receivy/common';

export const enum IntegrationCredentialKind {
  Token = 'token',
  Connect = 'connect'
}

/** What is not secret stays readable; the secret part lives sealed in `ciphertext`. */
export interface IntegrationCredentialsSchema {
  kind: IntegrationCredentialKind;
  /** AES-256-GCM `v1.<iv>.<tag>.<ct>` (base64url) of the secret: the API token, or the Connect access/refresh pair. */
  ciphertext: String.Max<2048>;
  /** Connect only, readable without decrypting. */
  accountId?: String.Max<120>;
  expiresAt?: String.DateTime;
  scope?: String.Max<200>;
}

/** One connected provider account per owner: the credential a payment method of that provider borrows. */
export interface IntegrationSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  provider: PaymentProvider;
  credentials: IntegrationCredentialsSchema;
  label: String.Max<120>;
  revoked_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
