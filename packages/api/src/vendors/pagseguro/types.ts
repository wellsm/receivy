export const enum PagSeguroHost {
  Live = 'https://api.pagseguro.com',
  Sandbox = 'https://sandbox.api.pagseguro.com'
}

export type PagSeguroCheckoutInput = {
  referenceId: string;
  amountCents: number;
  description: string;
  expiresAt: string;
  redirectUrl: string;
  webhookUrl: string;
};

export type PagSeguroVerifyResult = { status: 'valid' } | { status: 'invalid' } | { status: 'unavailable' };

export type PagSeguroCheckoutResult = { status: 'created'; id: string; url: string } | { status: 'unauthorized' } | { status: 'unavailable' };

export type PagSeguroOrderCharge = {
  id: string;
  status: string;
  amountCents: number;
  paidCents: number;
  method: string;
};

export type PagSeguroOrderResult = { status: 'found'; charges: PagSeguroOrderCharge[] } | { status: 'unauthorized' } | { status: 'unavailable' };

export type PagSeguroInactivateResult = { status: 'done' } | { status: 'unauthorized' } | { status: 'unavailable' };

export interface PagSeguroClient {
  verifyToken(token: string): Promise<PagSeguroVerifyResult>;
  createCheckout(token: string, input: PagSeguroCheckoutInput): Promise<PagSeguroCheckoutResult>;
  getOrder(token: string, orderId: string): Promise<PagSeguroOrderResult>;
  inactivate(token: string, checkoutId: string): Promise<PagSeguroInactivateResult>;
}

/** The order PagBank posts to `notification_urls` (subset the API reads). */
export type PagSeguroOrderNotification = {
  id?: string;
  reference_id?: string;
  charges?: {
    id?: string;
    status?: string;
    amount?: { value?: number; summary?: { paid?: number } };
    payment_method?: { type?: string };
  }[];
};
