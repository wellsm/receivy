import type { PaymentLinkProvider } from './types';

/** Links this process created, by order_nsu: the fake `payment_check` confirms exactly what was linked. */
const links = new Map<string, { amountCents: number }>();

/** Test-only: how many links this process has created so far, to assert a probe did (or did not) run. */
export function fakeLinkCount(): number {
  return links.size;
}

/**
 * Stands in for InfinitePay on local and test: every handle works, the link points at the web's `/dev/infinitepay`
 * page (which carries the redirect back so a person can "pay" by hand), and a check pays exactly the amount that
 * was linked. A transaction nsu starting with `unpaid` is refused; an order never linked in this process is
 * unknown (`paid: false`).
 */
export function createFakePaymentLinkProvider(webOrigin: string): PaymentLinkProvider {
  return {
    async createLink(input) {
      links.set(input.orderNsu, { amountCents: input.items.reduce((total, item) => total + item.quantity * item.price, 0) });

      const redirect = input.redirectUrl ? `?redirect=${encodeURIComponent(input.redirectUrl)}` : '';

      return { status: 'created', url: `${webOrigin.replace(/\/+$/, '')}/dev/infinitepay/${input.orderNsu}${redirect}` };
    },

    async checkPayment(input) {
      const linked = links.get(input.orderNsu);
      const paid = !!linked && !input.transactionNsu.startsWith('unpaid');

      return { status: 'checked', paid, amountCents: linked?.amountCents ?? 0, paidAmountCents: linked?.amountCents ?? 0, captureMethod: 'pix' };
    }
  };
}
