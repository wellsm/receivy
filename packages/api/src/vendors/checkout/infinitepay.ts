import { PaymentProvider } from '@receivy/common';
import type { PaymentLinkProvider } from '../infinitepay/types';
import type { CheckoutClient } from './types';

/** InfinitePay through the common checkout interface: the handle is the identity, there is no credential, no inactivation. */
export function infinitePayCheckout(client: PaymentLinkProvider): CheckoutClient {
  return {
    async createLink(input) {
      if (!input.identity) {
        return { status: 'unavailable' };
      }

      return client.createLink({
        handle: input.identity,
        orderNsu: input.orderNsu,
        items: [{ quantity: 1, price: input.amountCents, description: input.description }],
        webhookUrl: input.webhookUrl,
        redirectUrl: input.redirectUrl
      });
    },

    async checkPayment(input) {
      if (input.provider !== PaymentProvider.InfinitePay) {
        return { status: 'unavailable' };
      }

      return client.checkPayment({ handle: input.identity, orderNsu: input.orderNsu, transactionNsu: input.transactionNsu, slug: input.slug });
    },

    async inactivate() {
      return { status: 'unsupported' };
    },

    async verifyCredential() {
      return { status: 'unsupported' };
    }
  };
}
