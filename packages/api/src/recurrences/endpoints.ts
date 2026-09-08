import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { RecurrenceDetail, RecurrenceInput, RecurrencesPage } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { createRecurrence, editRecurrence, getRecurrence, listRecurrences, transitionRecurrence } from './repository';

declare class RecurrenceBody implements Http.JsonBody {
  description?: String.Max<500>;
  totalCents: Integer.Min<1>;
  frequency: 'monthly' | 'yearly';
  day: Integer.Range<1, 31>;
  month?: Integer.Range<1, 12>;
  startDate?: String.Date;
  endDate?: String.Date;
  timezone: String.Max<100>;
  paymentMethodId?: String.UUID;
  split: {
    mode: 'fixed' | 'equal' | 'percentage';
    parts: (
      | { kind: 'owner'; basisPoints?: number }
      | { kind: 'person'; personId: String.UUID; amountCents?: number; basisPoints?: number }
    )[];
  };
  reminders?: { offsetDays: Integer.Range<-90, 90>; channel: 'auto'; enabled: boolean }[];
}
declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: RecurrenceBody;
}
declare class ReadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class EditRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: RecurrenceBody;
}
declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
}
declare class DetailResponse implements Http.Response {
  status: 200;
  body: RecurrenceDetail;
}
declare class CreateResponse implements Http.Response {
  status: 201;
  body: RecurrenceDetail;
}
declare class ListResponse implements Http.Response {
  status: 200;
  body: RecurrencesPage;
}
async function validation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) throw new HttpBadRequestError(error.message);
    throw error;
  }
}
export async function createRecurrenceHandler(request: CreateRequest, context: Service.Context<ApiProvider>): Promise<CreateResponse> {
  return {
    status: 201,
    body: await validation(() =>
      createRecurrence(context.db, request.identity.userId, request.headers['idempotency-key'], request.body as RecurrenceInput)
    )
  };
}
export async function editRecurrenceHandler(request: EditRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return {
    status: 200,
    body: await validation(() =>
      editRecurrence(context.db, request.identity.userId, request.parameters.id, request.body as RecurrenceInput)
    )
  };
}
export async function getRecurrenceHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return { status: 200, body: await getRecurrence(context.db, request.identity.userId, request.parameters.id) };
}
export async function listRecurrencesHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ListResponse> {
  return { status: 200, body: { recurrences: await listRecurrences(context.db, request.identity.userId) } };
}
export async function pauseRecurrenceHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return { status: 200, body: await transitionRecurrence(context.db, request.identity.userId, request.parameters.id, 'paused') };
}
export async function reactivateRecurrenceHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return { status: 200, body: await transitionRecurrence(context.db, request.identity.userId, request.parameters.id, 'active') };
}
export async function endRecurrenceHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return { status: 200, body: await transitionRecurrence(context.db, request.identity.userId, request.parameters.id, 'ended') };
}
