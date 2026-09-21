import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { ReminderSettings } from '@receivy/common';
import { type ChannelSetBody, type ReminderBody } from '../../billings/utils/body';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';

declare class RemindersRequest implements Http.Request {
  identity: SessionIdentity;
  body: { reminders: ReminderBody[]; manual: ChannelSetBody };
}

declare class RemindersResponse implements Http.Response {
  status: 200;
  body: ReminderSettings;
}

export async function putRemindersHandler({ identity, body }: RemindersRequest, { accounts }: Service.Context<UserProvider>): Promise<RemindersResponse> {
  return { status: 200, body: await accounts.saveReminders(identity.userId, body) };
}
