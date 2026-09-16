import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ListCharge } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ChargeProvider } from '../provider';
import { ChargeRepository } from '../repositories/charge';

declare class ListChargesRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    month: String.Max<7>;
  };
}

declare class ListChargesResponse implements Http.Response {
  status: 200;
  body: ListCharge;
}

export async function listChargesHandler(
  { identity, query }: ListChargesRequest,
  { db }: Service.Context<ChargeProvider>
): Promise<ListChargesResponse> {
  const { month } = query;

  const charges = await ChargeRepository.list(db, identity.userId, { month });

  return { status: 200, body: charges };
}
