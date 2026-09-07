import type { Client, Database, Index } from "@ez4/database";
import type { PostgresEngine } from "@ez4/raw-pg/client";
import type { AuthIdentitySchema } from "./schemas/auth-identity";
import type { LoginCodeSchema } from "./schemas/login-code";
import type { OauthAttemptSchema } from "./schemas/oauth-attempt";
import type { OauthGrantSchema } from "./schemas/oauth-grant";
import type { RefreshTokenSchema } from "./schemas/refresh-token";
import type { SessionFamilySchema } from "./schemas/session-family";
import type { UserSchema } from "./schemas/user";
import type { PersonSchema } from "./schemas/person";
import type { PersonContactSchema } from "./schemas/person-contact";
import type { PaymentMethodSchema } from "./schemas/payment-method";
import type { ExpenseSchema } from "./schemas/expense";
import type { ExpenseAllocationSchema } from "./schemas/expense-allocation";
import type { ChargeSchema } from "./schemas/charge";
import type { PaymentSchema } from "./schemas/payment";
import type { PublicLinkSchema } from "./schemas/public-link";
import type { ActivityEventSchema } from "./schemas/activity-event";
import type { OutboxEventSchema } from "./schemas/outbox-event";

export declare class Db extends Database.Service<PostgresEngine> {
  client: Client<Db>;

  tables: [
    Database.UseTable<{
      name: "payment_methods";
      schema: PaymentMethodSchema;
      relations: { "owner_id@owner": "users:id" };
      indexes: { id: Index.Primary; "owner_id:pix_key_type:pix_key": Index.Unique; owner_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "expenses";
      schema: ExpenseSchema;
      relations: { "owner_id@owner": "users:id"; "payment_method_id@payment_method": "payment_methods:id" };
      indexes: { id: Index.Primary; "owner_id:idempotency_key": Index.Unique; owner_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "expense_allocations";
      schema: ExpenseAllocationSchema;
      relations: { "expense_id@expense": "expenses:id"; "person_id@person": "people:id" };
      indexes: { id: Index.Primary; "expense_id:allocation_order": Index.Unique; expense_id: Index.Secondary; person_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "charges";
      schema: ChargeSchema;
      relations: { "creditor_id@creditor": "users:id"; "debtor_person_id@debtor_person": "people:id"; "recipient_user_id@recipient_user": "users:id" };
      indexes: {
        id: Index.Primary;
        creditor_id: Index.Secondary;
        recipient_user_id: Index.Secondary;
        recipient_email_snapshot: Index.Secondary;
        debtor_person_id: Index.Secondary;
        source_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: "payments";
      schema: PaymentSchema;
      relations: { "charge_id@charge": "charges:id"; "registered_by_id@registered_by": "users:id" };
      indexes: { id: Index.Primary; charge_id: Index.Unique; registered_by_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "public_links";
      schema: PublicLinkSchema;
      relations: { "charge_id@charge": "charges:id" };
      indexes: { id: Index.Primary; public_id: Index.Unique; charge_id: Index.Unique };
    }>,
    Database.UseTable<{
      name: "activity_events";
      schema: ActivityEventSchema;
      relations: { "actor_user_id@actor_user": "users:id"; "subject_user_id@subject_user": "users:id" };
      indexes: { id: Index.Primary; subject_user_id: Index.Secondary; aggregate_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "outbox_events";
      schema: OutboxEventSchema;
      relations: { "recipient_user_id@recipient_user": "users:id" };
      indexes: { id: Index.Primary; aggregate_id: Index.Secondary; "state:available_at": Index.Secondary };
    }>,
    Database.UseTable<{
      name: "people";
      schema: PersonSchema;
      relations: { "owner_id@owner": "users:id"; "linked_user_id@linked_user": "users:id" };
      indexes: { id: Index.Primary; "owner_id:active_email": Index.Unique; owner_id: Index.Secondary; linked_user_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "person_contacts";
      schema: PersonContactSchema;
      relations: { "person_id@person": "people:id" };
      indexes: { id: Index.Primary; "person_id:type": Index.Unique; normalized_value: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "users";
      schema: UserSchema;
      indexes: { id: Index.Primary; email: Index.Unique };
    }>,
    Database.UseTable<{
      name: "auth_identities";
      schema: AuthIdentitySchema;
      relations: { "user_id@user": "users:id" };
      indexes: {
        id: Index.Primary;
        "provider:provider_user_id": Index.Unique;
        user_id: Index.Secondary;
        email: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: "login_codes";
      schema: LoginCodeSchema;
      indexes: { id: Index.Primary; email: Index.Unique };
    }>,
    Database.UseTable<{
      name: "oauth_attempts";
      schema: OauthAttemptSchema;
      indexes: {
        id: Index.Primary;
        state_hash: Index.Unique;
      };
    }>,
    Database.UseTable<{
      name: "oauth_grants";
      schema: OauthGrantSchema;
      relations: { "user_id@user": "users:id" };
      indexes: {
        id: Index.Primary;
        grant_hash: Index.Unique;
        user_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: "session_families";
      schema: SessionFamilySchema;
      relations: { "user_id@user": "users:id" };
      indexes: { id: Index.Primary; user_id: Index.Secondary };
    }>,
    Database.UseTable<{
      name: "refresh_tokens";
      schema: RefreshTokenSchema;
      relations: { "family_id@family": "session_families:id" };
      indexes: {
        id: Index.Primary;
        token_hash: Index.Unique;
        family_id: Index.Secondary;
      };
    }>,
  ];
}

export type DbClient = Client<Db>;
