import type { Client, Database, Index } from '@ez4/database';
import type { PostgresEngine } from '@ez4/raw-pg/client';
import type {
  AllocationSchema,
  BillingSchema
} from './billings/schemas/billing';
import type { BillingGuestSchema } from './billings/schemas/billing-guest';
import type { ChargeSchema } from './charges/schemas/charge';
import type { EventSchema } from './common/schemas/event';
import type { ContactSchema } from './contacts/schemas/contact';
import type { BillingInviteSchema } from './invites/schemas/invite';
import type { DeviceTokenSchema } from './notifications/schemas/notification';
import type { PaymentMethodSchema } from './payment-methods/schemas/payment-method';
import type { ProofThrottleSchema } from './proofs/schemas/proof-throttle';
import type { AuthIdentitySchema } from './users/schemas/auth-identity';
import type { LoginCodeSchema } from './users/schemas/login-code';
import type { OauthAttemptSchema } from './users/schemas/oauth-attempt';
import type { OauthGrantSchema } from './users/schemas/oauth-grant';
import type { RefreshTokenSchema } from './users/schemas/refresh-token';
import type { SessionFamilySchema } from './users/schemas/session-family';
import type { UserSchema } from './users/schemas/user';

export declare class Db extends Database.Service<PostgresEngine> {
  client: Client<Db>;

  tables: [
    Database.UseTable<{
      name: 'device_tokens';
      schema: DeviceTokenSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: {
        id: Index.Primary;
        token: Index.Unique;
        'user_id:installation_id': Index.Unique;
      };
    }>,
    Database.UseTable<{
      name: 'proof_throttles';
      schema: ProofThrottleSchema;
      indexes: { id: Index.Primary };
    }>,
    Database.UseTable<{
      name: 'payment_methods';
      schema: PaymentMethodSchema;
      relations: { 'owner_id@owner': 'users:id' };
      indexes: {
        id: Index.Primary;
        'owner_id:pix_key_type:pix_key': Index.Unique;
        owner_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'billings';
      schema: BillingSchema;
      relations: {
        'owner_id@owner': 'users:id';
        'payment_method_id@payment_method': 'payment_methods:id';
        'payee_user_id@payee_user': 'users:id';
      };
      indexes: {
        id: Index.Primary;
        'owner_id:idempotency_key': Index.Unique;
        owner_id: Index.Secondary;
        'state:type': Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'allocations';
      schema: AllocationSchema;
      relations: {
        'billing_id@billing': 'billings:id';
        'user_id@user': 'users:id';
      };
      indexes: {
        id: Index.Primary;
        'billing_id:allocation_order': Index.Unique;
        billing_id: Index.Secondary;
        user_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'charges';
      schema: ChargeSchema;
      relations: {
        'creditor_id@creditor': 'users:id';
        'debtor_user_id@debtor': 'users:id';
        'billing_id@billing': 'billings:id';
        'proof_sender_user_id@proof_sender': 'users:id';
      };
      indexes: {
        id: Index.Primary;
        creditor_id: Index.Secondary;
        debtor_user_id: Index.Secondary;
        billing_id: Index.Secondary;
        'billing_id:debtor_user_id:due_date': Index.Unique;
        public_id: Index.Unique;
      };
    }>,
    Database.UseTable<{
      name: 'billing_invites';
      schema: BillingInviteSchema;
      relations: {
        'billing_id@billing': 'billings:id';
        'owner_id@owner': 'users:id';
      };
      indexes: {
        id: Index.Primary;
        public_id: Index.Unique;
        billing_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'billing_guests';
      schema: BillingGuestSchema;
      relations: {
        'billing_id@billing': 'billings:id';
        'owner_id@owner': 'users:id';
        'user_id@user': 'users:id';
      };
      indexes: {
        id: Index.Primary;
        'billing_id:user_id': Index.Unique;
        billing_id: Index.Secondary;
        owner_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'events';
      schema: EventSchema;
      relations: { 'actor_user_id@actor_user': 'users:id' };
      indexes: {
        id: Index.Primary;
        eventable_id: Index.Secondary;
        actor_user_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'contacts';
      schema: ContactSchema;
      relations: { 'owner_id@owner': 'users:id'; 'user_id@user': 'users:id' };
      indexes: {
        id: Index.Primary;
        'owner_id:user_id': Index.Unique;
        owner_id: Index.Secondary;
        user_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'users';
      schema: UserSchema;
      indexes: { id: Index.Primary; email: Index.Unique };
    }>,
    Database.UseTable<{
      name: 'auth_identities';
      schema: AuthIdentitySchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: {
        id: Index.Primary;
        'provider:provider_user_id': Index.Unique;
        user_id: Index.Secondary;
        email: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'login_codes';
      schema: LoginCodeSchema;
      indexes: { id: Index.Primary; email: Index.Unique };
    }>,
    Database.UseTable<{
      name: 'oauth_attempts';
      schema: OauthAttemptSchema;
      indexes: {
        id: Index.Primary;
        state_hash: Index.Unique;
      };
    }>,
    Database.UseTable<{
      name: 'oauth_grants';
      schema: OauthGrantSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: {
        id: Index.Primary;
        grant_hash: Index.Unique;
        user_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'session_families';
      schema: SessionFamilySchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: { id: Index.Primary; user_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'refresh_tokens';
      schema: RefreshTokenSchema;
      relations: { 'family_id@family': 'session_families:id' };
      indexes: {
        id: Index.Primary;
        token_hash: Index.Unique;
        family_id: Index.Secondary;
      };
    }>
  ];
}

export type DbClient = Client<Db>;
