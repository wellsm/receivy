import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { PaymentProvider } from '@receivy/common';
import { checkoutClients, paymentLinkConfigFrom } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { ChargeRepository } from '../../charges/repositories/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { credentialOf } from '../../integrations/utils/credential';
import { notificationTransport } from '../../notifications/services/transport';
import { PublicTokenPurpose, verifyPublicChargeToken } from '../../public/services/capability';
import { paymentOf } from '../../charges/utils/columns';
import type { PagSeguroOrderNotification } from '../../vendors/pagseguro/types';
import type { WebhookProvider } from '../provider';
import { signatureMatches, signatureOf } from '../utils/signature';

declare class PagSeguroWebhookRequest implements Http.Request {
  parameters: { token: String.Max<300> };
  headers: { 'x-authenticity-token'?: String.Max<128> };
  body: string;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/**
 * PagBank's notification: raw body signed with the seller's own token, checked before anything is trusted.
 * The order is re-read through `payment_check` (inside `settleByProvider`) rather than believed from the
 * payload; 200 closes the delivery in every case except "our side could not ask PagBank", which is a 400
 * PagBank retries.
 */
export async function pagSeguroWebhookHandler({ parameters, headers, body }: PagSeguroWebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  let chargeId: string;

  try {
    chargeId = verifyPublicChargeToken(parameters.token, { secret: variables.PUBLIC_LINK_HMAC_SECRET, purpose: PublicTokenPurpose.ProviderWebhook }).publicId;
  } catch {
    return RECEIVED;
  }

  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.PagSeguro) {
    return RECEIVED;
  }

  const config = paymentLinkConfigFrom(variables);
  const lookup = payment.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : { status: 'missing' as const };
  const stamp = new Date().toISOString();

  if (lookup.status !== 'ok') {
    await EventRepository.record(db, { type: 'charge.provider.ignored', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'no_credential' }, at: stamp });

    return RECEIVED;
  }

  if (!signatureMatches(signatureOf(lookup.secret, body), headers['x-authenticity-token'])) {
    await EventRepository.record(db, { type: 'charge.provider.rejected', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'signature' }, at: stamp });

    return RECEIVED;
  }

  let notification: PagSeguroOrderNotification;

  try {
    notification = JSON.parse(body) as PagSeguroOrderNotification;
  } catch {
    return RECEIVED;
  }

  if (notification.reference_id !== chargeId || typeof notification.id !== 'string') {
    return RECEIVED;
  }

  const paid = notification.charges?.find((item) => item.status === 'PAID' && typeof item.id === 'string');

  if (!paid) {
    await EventRepository.record(
      db,
      { type: 'charge.provider.rejected', eventableType: EventableType.Charge, eventableId: chargeId, payload: { reason: 'not_paid', statuses: notification.charges?.map((item) => item.status) }, at: stamp }
    );

    return RECEIVED;
  }

  const outcome = await settleByProvider(
    db,
    checkoutClients(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { provider: PaymentProvider.PagSeguro, chargeId, transactionNsu: paid.id!, orderId: notification.id, credential: lookup.secret }
  );

  console.info('PagBank webhook', { chargeId, outcome });

  if (outcome === 'unavailable') {
    throw new HttpBadRequestError('Order check unavailable');
  }

  return RECEIVED;
}
