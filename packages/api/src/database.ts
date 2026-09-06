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

export declare class Db extends Database.Service<PostgresEngine> {
  client: Client<Db>;

  tables: [
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
