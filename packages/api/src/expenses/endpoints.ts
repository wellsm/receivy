import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { ExpenseDetail, ExpenseInput, ExpenseSplit } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { createExpense, getExpense } from './repository';

declare class SplitBody {
  mode: 'fixed' | 'equal' | 'percentage';
  parts: (
    | { kind: 'owner'; basisPoints?: number }
    | { kind: 'person'; personId: String.UUID; amountCents?: number; basisPoints?: number }
  )[];
}
declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: {
    description?: String.Max<500>;
    totalCents: Integer.Min<1>;
    installmentCount: Integer.Range<1, 360>;
    firstDueDate: String.Date;
    split: SplitBody;
    paymentMethodId?: String.UUID;
  };
}
declare class GetRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class CreateResponse implements Http.Response {
  status: 201;
  body: ExpenseDetail;
}
declare class GetResponse implements Http.Response {
  status: 200;
  body: ExpenseDetail;
}

export async function createExpenseHandler(request: CreateRequest, context: Service.Context<ApiProvider>): Promise<CreateResponse> {
  try {
    return {
      status: 201,
      body: await createExpense(
        context.db,
        request.identity.userId,
        request.headers['idempotency-key'],
        request.body as ExpenseInput & { split: ExpenseSplit }
      )
    };
  } catch (error) {
    if (error instanceof RangeError) throw new HttpBadRequestError(error.message);
    throw error;
  }
}
export async function getExpenseHandler(request: GetRequest, context: Service.Context<ApiProvider>): Promise<GetResponse> {
  return { status: 200, body: await getExpense(context.db, request.identity.userId, request.parameters.id) };
}
