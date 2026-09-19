import type { PaymentProvider } from '@receivy/common';
import type { CheckoutClient, CheckoutProvider } from './types';

/** Links this process created, by order: the fake check confirms exactly what was linked. */
const links = new Map<string, { amountCents: number }>();

/** Test-only: how many links this process has created so far, to assert a probe did (or did not) run. */
export function fakeLinkCount(): number {
  return links.size;
}

/**
 * Stands in for any provider on local and test: every handle and every token works, the link points at the web's
 * `/dev/checkout/<provider>/<order>` page (carrying the redirect back), a check pays exactly what was linked, and a
 * transaction nsu starting with `unpaid` is refused. Inactivation always succeeds.
 */
export function fakeCheckout(webOrigin: string, provider: CheckoutProvider): CheckoutClient {
  const origin = webOrigin.replace(/\/+$/, '');

  return {
    async createLink(input) {
      links.set(input.orderNsu, { amountCents: input.amountCents });

      const redirect = input.redirectUrl ? `?redirect=${encodeURIComponent(input.redirectUrl)}` : '';

      return { status: 'created', url: `${origin}/dev/checkout/${provider}/${input.orderNsu}${redirect}`, linkId: `fake-${input.orderNsu}` };
    },

    // Every handler is its own bundle (and its own Lambda), so a link made by `ensurePaymentLink` is unknown here:
    // the check trusts the amount the caller expects and only refuses an `unpaid` transaction.
    async checkPayment(input) {
      const orderNsu = input.provider === (provider as PaymentProvider) ? ('orderNsu' in input ? input.orderNsu : input.orderId) : '';
      const amountCents = links.get(orderNsu)?.amountCents ?? input.expectedAmountCents;
      const paid = !input.transactionNsu.startsWith('unpaid');

      return { status: 'checked', paid, amountCents, paidAmountCents: amountCents, captureMethod: 'pix' };
    },

    async inactivate() {
      return { status: 'done' };
    },

    async verifyCredential() {
      return { status: 'valid' };
    }
  };
}
