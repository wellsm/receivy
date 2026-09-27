import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { WhatsappGroup } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class GroupsRequest implements Http.Request {
  identity: SessionIdentity;
  /** The billing's participants, comma separated user ids: the groups with all of them come first. */
  query: { participants?: String.Max<2000> };
}

declare class GroupsResponse implements Http.Response {
  status: 200;
  body: { groups: WhatsappGroup[] };
}

export async function getWhatsappGroupsHandler({ identity, query }: GroupsRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<GroupsResponse> {
  const participants = (query.participants ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return { status: 200, body: { groups: await whatsappInstances.groups(identity.userId, participants) } };
}
