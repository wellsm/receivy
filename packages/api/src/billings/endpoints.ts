import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { BillingDetail, BillingInput, BillingPatch, BillingPreview, BillingsPage } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import { noticeContext } from '../notifications/context';
import type { ApiProvider } from '../provider';
import { createBilling, getBilling, type InviteLinkContext, listBillings, patchBilling, previewBilling } from './repository';

// Keep the arms explicit: EZ4 reflection cannot extract intersections out of a union.
declare class SplitBody {
  mode: 'fixed' | 'equal' | 'percentage' | 'shares';
  parts: (
    | { kind: 'owner'; basisPoints?: number; shares?: Integer.Range<1, 1000> }
    | { kind: 'person'; personId: String.UUID; amountCents?: number; basisPoints?: number; shares?: Integer.Range<1, 1000> }
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
  category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
}

declare class PatchBody implements Http.JsonBody {
  description?: String.Max<500>;
  totalCents?: Integer.Min<1>;
  split?: SplitBody;
  paymentMethodId?: String.UUID;
  clearPaymentMethod?: boolean;
  reminders?: ReminderBody[];
  state?: 'active' | 'paused' | 'ended';
  category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
}

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: BillingBody;
}

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    type?: 'once' | 'until' | 'indefinite';
    state?: 'active' | 'paused' | 'ended';
    cursor?: String.Max<500>;
    search?: String.Max<80>;
    category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
  };
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

function inviteLink(context: Service.Context<ApiProvider>): InviteLinkContext {
  return { secret: context.variables.PUBLIC_LINK_HMAC_SECRET, webOrigin: context.variables.PUBLIC_WEB_ORIGIN };
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

export async function listBillingsHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ListResponse> {
  return { status: 200, body: await listBillings(context.db, request.identity.userId, request.query) };
}

export async function getBillingHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  return {
    status: 200,
    body: await getBilling(context.db, request.identity.userId, request.parameters.id, new Date(), inviteLink(context))
  };
}

export async function previewBillingHandler(request: ReadRequest, context: Service.Context<ApiProvider>): Promise<PreviewResponse> {
  return { status: 200, body: await previewBilling(context.db, request.identity.userId, request.parameters.id) };
}

export async function patchBillingHandler(request: PatchRequest, context: Service.Context<ApiProvider>): Promise<DetailResponse> {
  const body = await validation(() =>
    patchBilling(context.db, request.identity.userId, request.parameters.id, request.body as BillingPatch, new Date(), inviteLink(context))
  );

  return { status: 200, body };
}
