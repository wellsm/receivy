import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { DevicePlatform } from '@receivy/common';
export interface DeviceTokenSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  token: String.Max<300>;
  installation_id: String.Max<100>;
  session_family_id?: String.UUID;
  platform: DevicePlatform;
  active: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
