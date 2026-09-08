import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { BillingDetail, BillingInput, BillingPatch, BillingPreview, BillingsPage } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { createBilling, getBilling, listBillings, patchBilling, previewBilling } from './repository';

declare class SplitBody {
  mode: 'fixed' | 'equal' | 'percentage';
  parts: (
    | { kind: 'owner'; basisPoints?: number }
    | { kind: 'person'; personId: String.UUID; amountCents?: number; basisPoints?: number }
  )[];
}

declare class ReminderBody {
  offsetDays: Integer.Range<-90, 90>;
  enabled: boolean;
}

declare class BillingBody implements Http.JsonBody {
  type: 'once' | 'until' | 'indefinite';
  frequency?: 'monthly' | 'yearly';
  description?: String.Max<500>;
  totalCents: Integer.Min<1>;
  startDate: String.Date;
  endDate?: String.Date;
  timezone: String.Max<100>;
  paymentMethodId?: String.UUID;
  reminders?: ReminderBody[];
  split: SplitBody;
}

declare class PatchBody implements Http.JsonBody {
  description?: String.Max<500>;
  totalCents?: Integer.Min<1>;
  split?: SplitBody;
  paymentMethodId?: String.UUID;
  clearPaymentMethod?: boolean;
  reminders?: ReminderBody[];
  state?: 'active' | 'paused' | 'ended';
}

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: BillingBody;
}

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: { type?: 'once' | 'until' | 'indefinite'; state?: 'active' | 'paused' | 'ended'; cursor?: String.Max<500> };
}

declare class ReadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class PatchRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: PatchBody;
}

declare class CreateResponse implements Http.Response {
  status: 201;
  body: BillingDetail;
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: BillingsPage;
}

declare class PreviewResponse implements Http.Response {
  status: 200;
  body: { previews: BillingPreview[] };
}

async function validation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HttpBadRequestError(error.message);
    }

    throw error;
  }
}

export async function createBillingHandler(request: CreateRequest, context: Service.Context<ApiProvider>): Promise<CreateResponse> {
  const body = await validation(() =>
    createBilling(context.db, request.identity.userId, request.headers['idempotency-key'], request.body as BillingInput)
  );

  return { status: 201, body };
}

export async function listBillingsHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ListResponse> {
  return { status: 200, body: await listBillings(context.db, request.identity.userId, request.query) };
}

export async function getBillingHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return { status: 200, body: await getBilling(context.db, request.identity.userId, request.parameters.id) };
}

export async function previewBillingHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<PreviewResponse> {
  return { status: 200, body: await previewBilling(context.db, request.identity.userId, request.parameters.id) };
}

export async function patchBillingHandler(request: PatchRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  const body = await validation(() =>
    patchBilling(context.db, request.identity.userId, request.parameters.id, request.body as BillingPatch)
  );

  return { status: 200, body };
}
