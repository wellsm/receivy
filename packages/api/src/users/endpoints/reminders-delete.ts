import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { ReminderSettings } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';

declare class RemindersRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class RemindersResponse implements Http.Response {
  status: 200;
  body: ReminderSettings;
}

export async function deleteRemindersHandler({ identity }: RemindersRequest, { accounts }: Service.Context<UserProvider>): Promise<RemindersResponse> {
  return { status: 200, body: await accounts.clearReminders(identity.userId) };
}
