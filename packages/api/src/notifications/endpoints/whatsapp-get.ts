import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { WhatsappSettings } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { whatsappSettings } from '../../users/services/account';
import type { NotificationProvider } from '../provider';

declare class SettingsRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class SettingsResponse implements Http.Response {
  status: 200;
  body: WhatsappSettings;
}

export async function getWhatsappHandler({ identity }: SettingsRequest, { db, variables }: Service.Context<NotificationProvider>): Promise<SettingsResponse> {
  return { status: 200, body: await whatsappSettings(db, identity.userId, variables) };
}
