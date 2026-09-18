export type PaymentLinkItem = { quantity: number; price: number; description: string };

export type PaymentLinkInput = {
  handle: string;
  orderNsu: string;
  items: PaymentLinkItem[];
  webhookUrl?: string;
  redirectUrl?: string;
};

export type PaymentCheckInput = { handle: string; orderNsu: string; transactionNsu: string; slug: string };

export type PaymentLinkResult = { status: 'created'; url: string } | { status: 'checkout_disabled'; redirectUrl: string } | { status: 'unavailable' };

export type PaymentCheckResult =
  | { status: 'checked'; paid: boolean; amountCents: number; paidAmountCents: number; captureMethod: string }
  | { status: 'unavailable' };

/** What the API needs from a checkout provider; InfinitePay is the only one, the fake stands in for it locally. */
export interface PaymentLinkProvider {
  createLink(input: PaymentLinkInput): Promise<PaymentLinkResult>;
  checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult>;
}
