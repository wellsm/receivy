import { PaymentProvider } from '@receivy/common';
import type { PagSeguroClient } from '../pagseguro/types';
import type { CheckoutClient } from './types';

const PAID = 'PAID';

/** PagBank through the common checkout interface: the credential is the seller's token, decrypted by the caller for this call only. */
export function pagSeguroCheckout(client: PagSeguroClient): CheckoutClient {
  return {
    async createLink(input) {
      if (!input.credential || !input.webhookUrl || !input.redirectUrl) {
        return { status: 'unavailable' };
      }

      const result = await client.createCheckout(input.credential, {
        referenceId: input.orderNsu,
        amountCents: input.amountCents,
        description: input.description,
        expiresAt: input.expiresAt,
        redirectUrl: input.redirectUrl,
        webhookUrl: input.webhookUrl
      });

      if (result.status !== 'created') {
        return result;
      }

      return { status: 'created', url: result.url, linkId: result.id };
    },

    async checkPayment(input) {
      if (input.provider !== PaymentProvider.PagSeguro) {
        return { status: 'unavailable' };
      }

      const order = await client.getOrder(input.credential, input.orderId);

      if (order.status !== 'found') {
        return order;
      }

      // Defence in depth: an order pointed at another of the seller's own charges never settles this one.
      if (order.referenceId !== undefined && order.referenceId !== input.chargeId) {
        return { status: 'checked', paid: false, amountCents: 0, paidAmountCents: 0, captureMethod: '' };
      }

      const charge = order.charges.find((item) => item.id === input.transactionNsu);

      if (!charge) {
        return { status: 'checked', paid: false, amountCents: 0, paidAmountCents: 0, captureMethod: '' };
      }

      return { status: 'checked', paid: charge.status === PAID, amountCents: charge.amountCents, paidAmountCents: charge.paidCents, captureMethod: charge.method.toLowerCase() };
    },

    async inactivate(input) {
      if (!input.credential) {
        return { status: 'unauthorized' };
      }

      return client.inactivate(input.credential, input.linkId);
    },

    verifyCredential: (credential) => client.verifyToken(credential)
  };
}
