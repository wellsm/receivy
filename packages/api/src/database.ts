import type { Client, Database, Index } from '@ez4/database';
import type { PostgresEngine } from '@ez4/raw-pg/client';
import type { ActivityEventSchema } from './schemas/activity-event';
import type { AppleCredentialSchema } from './schemas/apple-credential';
import type { AuthIdentitySchema } from './schemas/auth-identity';
import type { AllocationSchema, BillingSchema } from './schemas/billing';
import type { ChargeSchema } from './schemas/charge';
import type { LoginCodeSchema } from './schemas/login-code';
import type { DeviceTokenSchema, NotificationDeliverySchema, NotificationPreferenceSchema } from './schemas/notification';
import type { OauthAttemptSchema } from './schemas/oauth-attempt';
import type { OauthGrantSchema } from './schemas/oauth-grant';
import type { OutboxEventSchema } from './schemas/outbox-event';
import type { PaymentSchema } from './schemas/payment';
import type { PaymentMethodSchema } from './schemas/payment-method';
import type { PaymentProofSchema, ProofThrottleSchema, UploadIntentSchema } from './schemas/payment-proof';
import type { PersonSchema } from './schemas/person';
import type { PersonContactSchema } from './schemas/person-contact';
import type { PublicLinkSchema } from './schemas/public-link';
import type { RefreshTokenSchema } from './schemas/refresh-token';
import type { SessionFamilySchema } from './schemas/session-family';
import type { StorageCleanupCursorSchema, StorageDeletionSchema } from './schemas/storage-deletion';
import type { UserSchema } from './schemas/user';

export declare class Db extends Database.Service<PostgresEngine> {
  client: Client<Db>;

  tables: [
    Database.UseTable<{
      name: 'apple_credentials';
      schema: AppleCredentialSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: { id: Index.Primary; user_id: Index.Secondary; fingerprint: Index.Secondary; 'state:available_at': Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'storage_deletions';
      schema: StorageDeletionSchema;
      indexes: { id: Index.Primary; object_key: Index.Unique; charge_id: Index.Secondary; 'state:available_at': Index.Secondary };
    }>,
    Database.UseTable<{ name: 'storage_cleanup_cursors'; schema: StorageCleanupCursorSchema; indexes: { id: Index.Primary } }>,
    Database.UseTable<{
      name: 'notification_preferences';
      schema: NotificationPreferenceSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: { id: Index.Primary; user_id: Index.Unique };
    }>,
    Database.UseTable<{
      name: 'device_tokens';
      schema: DeviceTokenSchema;
      relations: { 'user_id@user': 'users:id' };
      indexes: { id: Index.Primary; token: Index.Unique; 'user_id:installation_id': Index.Unique };
    }>,
    Database.UseTable<{
      name: 'notification_deliveries';
      schema: NotificationDeliverySchema;
      indexes: { id: Index.Primary; idempotency_key: Index.Unique; charge_id: Index.Secondary; 'state:available_at': Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'payment_proofs';
      schema: PaymentProofSchema;
      relations: { 'charge_id@charge': 'charges:id'; 'sender_user_id@sender_user': 'users:id'; 'reviewer_id@reviewer': 'users:id' };
      indexes: { id: Index.Primary; charge_id: Index.Secondary; object_key: Index.Unique };
    }>,
    Database.UseTable<{
      name: 'upload_intents';
      schema: UploadIntentSchema;
      relations: { 'charge_id@charge': 'charges:id'; 'sender_user_id@sender_user': 'users:id' };
      indexes: { id: Index.Primary; charge_id: Index.Secondary; object_key: Index.Unique };
    }>,
    Database.UseTable<{ name: 'proof_throttles'; schema: ProofThrottleSchema; indexes: { id: Index.Primary } }>,
    Database.UseTable<{
      name: 'payment_methods';
      schema: PaymentMethodSchema;
      relations: { 'owner_id@owner': 'users:id' };
      indexes: { id: Index.Primary; 'owner_id:pix_key_type:pix_key': Index.Unique; owner_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'billings';
      schema: BillingSchema;
      relations: { 'owner_id@owner': 'users:id'; 'payment_method_id@payment_method': 'payment_methods:id' };
      indexes: { id: Index.Primary; 'owner_id:idempotency_key': Index.Unique; owner_id: Index.Secondary; 'state:type': Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'allocations';
      schema: AllocationSchema;
      relations: { 'billing_id@billing': 'billings:id'; 'person_id@person': 'people:id' };
      indexes: { id: Index.Primary; 'billing_id:allocation_order': Index.Unique; billing_id: Index.Secondary; person_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'charges';
      schema: ChargeSchema;
      relations: {
        'creditor_id@creditor': 'users:id';
        'debtor_person_id@debtor_person': 'people:id';
        'recipient_user_id@recipient_user': 'users:id';
        'billing_id@billing': 'billings:id';
      };
      indexes: {
        id: Index.Primary;
        creditor_id: Index.Secondary;
        recipient_user_id: Index.Secondary;
        recipient_email_snapshot: Index.Secondary;
        debtor_person_id: Index.Secondary;
        billing_id: Index.Secondary;
        'billing_id:debtor_person_id:due_date': Index.Unique;
      };
    }>,
    Database.UseTable<{
      name: 'payments';
      schema: PaymentSchema;
      relations: { 'charge_id@charge': 'charges:id'; 'registered_by_id@registered_by': 'users:id'; 'proof_id@proof': 'payment_proofs:id' };
      indexes: { id: Index.Primary; charge_id: Index.Unique; registered_by_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'public_links';
      schema: PublicLinkSchema;
      relations: { 'charge_id@charge': 'charges:id' };
      indexes: { id: Index.Primary; public_id: Index.Unique; charge_id: Index.Unique };
    }>,
    Database.UseTable<{
      name: 'activity_events';
      schema: ActivityEventSchema;
      relations: { 'actor_user_id@actor_user': 'users:id'; 'subject_user_id@subject_user': 'users:id' };
      indexes: { id: Index.Primary; subject_user_id: Index.Secondary; aggregate_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'outbox_events';
      schema: OutboxEventSchema;
      relations: { 'recipient_user_id@recipient_user': 'users:id' };
      indexes: { id: Index.Primary; aggregate_id: Index.Secondary; 'state:available_at': Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'people';
      schema: PersonSchema;
      relations: { 'owner_id@owner': 'users:id'; 'linked_user_id@linked_user': 'users:id' };
      indexes: { id: Index.Primary; 'owner_id:active_email': Index.Unique; owner_id: Index.Secondary; linked_user_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: 'person_contacts';
      schema: PersonContactSchema;
      relations: { 'person_id@person': 'people:id' };
      indexes: { id: Index.Primary; 'person_id:type': Index.Unique; normalized_value: Index.Secondary };
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
