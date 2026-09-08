import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethod, PaymentMethodInput, PaymentMethodsPage } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { archivePaymentMethod, listPaymentMethods, makeDefaultPaymentMethod, savePaymentMethod } from './repository';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: { archived?: boolean };
}
declare class InputBody implements Http.JsonBody {
  pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  pixKey: String.Max<254>;
  label?: String.Max<120>;
}
declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  body: InputBody;
}
declare class EditRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: InputBody;
}
declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class ListResponse implements Http.Response {
  status: 200;
  body: PaymentMethodsPage;
}
declare class CreateResponse implements Http.Response {
  status: 201;
  body: PaymentMethod;
}
declare class ItemResponse implements Http.Response {
  status: 200;
  body: PaymentMethod;
}
declare class EmptyResponse implements Http.Response {
  status: 204;
}

function input(body: InputBody): PaymentMethodInput {
  return { pixKeyType: body.pixKeyType, pixKey: body.pixKey, label: body.label };
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) throw new HttpBadRequestError(error.message);
    throw error;
  }
}

export async function listPaymentMethodsHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ListResponse> {
  return { status: 200, body: { paymentMethods: await listPaymentMethods(context.db, request.identity.userId, request.query.archived) } };
}
export async function createPaymentMethodHandler(request: CreateRequest, context: Service.Context<ApiProvider>): Promise<CreateResponse> {
  return { status: 201, body: await safe(() => savePaymentMethod(context.db, request.identity.userId, input(request.body))) };
}
export async function editPaymentMethodHandler(request: EditRequest, context: Service.Context<ApiProvider>): Promise<ItemResponse> {
  return {
    status: 200,
    body: await safe(() => savePaymentMethod(context.db, request.identity.userId, input(request.body), request.parameters.id))
  };
}
export async function defaultPaymentMethodHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<ItemResponse> {
  return { status: 200, body: await makeDefaultPaymentMethod(context.db, request.identity.userId, request.parameters.id) };
}
export async function archivePaymentMethodHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<EmptyResponse> {
  await archivePaymentMethod(context.db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
