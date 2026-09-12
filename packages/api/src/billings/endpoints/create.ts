import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail, BillingInput } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { noticeContext } from '../../notifications/services/context';
import type { BillingProvider } from '../provider';
import { createBilling } from '../repositories/billing';
import type { BillingBody } from '../utils/body';
import { inviteLink, validation } from '../utils/context';

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: BillingBody;
}

declare class CreateResponse implements Http.Response {
  status: 201;
  body: BillingDetail;
}

export async function createBillingHandler(request: CreateRequest, context: Service.Context<BillingProvider>): Promise<CreateResponse> {
  const body = await validation(() =>
    createBilling(
      context.db,
      request.identity.userId,
      request.headers['idempotency-key'],
      request.body as BillingInput,
      new Date(),
      inviteLink(context),
      noticeContext(context)
    )
  );

  return { status: 201, body };
}
