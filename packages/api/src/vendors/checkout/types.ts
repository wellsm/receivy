import type { PaymentProvider } from '@receivy/common';

/** A provider that hosts a checkout page; a Pix key has none. */
export type CheckoutProvider = PaymentProvider.InfinitePay | PaymentProvider.PagSeguro;

export type CheckoutLinkInput = {
  orderNsu: string;
  amountCents: number;
  description: string;
  webhookUrl?: string;
  redirectUrl?: string;
  expiresAt: string;
  /** InfinitePay: the handle. */
  identity?: string;
  /** PagBank: the decrypted token. */
  credential?: string;
};

export type CheckoutLinkResult =
  | { status: 'created'; url: string; linkId?: string }
  | { status: 'checkout_disabled'; redirectUrl: string }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

/** `expectedAmountCents` is what the charge asks for: real clients ignore it, the fake echoes it when another process made the link. */
export type CheckoutCheckInput =
  | { provider: PaymentProvider.InfinitePay; identity: string; orderNsu: string; transactionNsu: string; slug: string; expectedAmountCents: number }
  | { provider: PaymentProvider.PagSeguro; credential: string; orderId: string; transactionNsu: string; chargeId: string; expectedAmountCents: number };

export type CheckoutCheckResult =
  | { status: 'checked'; paid: boolean; amountCents: number; paidAmountCents: number; captureMethod: string }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

export type CheckoutInactivateResult = { status: 'done' | 'unsupported' | 'unauthorized' | 'unavailable' };

export type CredentialVerifyResult = { status: 'valid' | 'invalid' | 'unsupported' | 'unavailable' };

/** What the API needs from any checkout provider; every vendor client is wrapped into this shape. */
export interface CheckoutClient {
  createLink(input: CheckoutLinkInput): Promise<CheckoutLinkResult>;
  checkPayment(input: CheckoutCheckInput): Promise<CheckoutCheckResult>;
  inactivate(input: { credential?: string; linkId: string }): Promise<CheckoutInactivateResult>;
  verifyCredential(credential: string): Promise<CredentialVerifyResult>;
}

/** One client per provider: the caller picks by the charge's frozen provider, never by configuration. */
export type CheckoutClients = Record<CheckoutProvider, CheckoutClient>;
