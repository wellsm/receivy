import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class QueuedResponse implements Http.Response {
  status: 202;
  body: { queued: boolean };
}

export async function manualReminderHandler({ identity, parameters }: IdRequest, { notifications }: Service.Context<NotificationProvider>): Promise<QueuedResponse> {
  return { status: 202, body: await notifications.manualReminder(identity.userId, parameters.id) };
}
