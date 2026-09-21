import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ManualReminderResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class PreviewResponse implements Http.Response {
  status: 200;
  body: ManualReminderResult;
}

export async function reminderPreviewHandler({ identity, parameters }: IdRequest, { notifications }: Service.Context<NotificationProvider>): Promise<PreviewResponse> {
  return { status: 200, body: await notifications.reminderPreview(identity.userId, parameters.id) };
}
