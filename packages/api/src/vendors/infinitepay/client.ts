import type { PaymentCheckInput, PaymentCheckResult, PaymentLinkInput, PaymentLinkProvider, PaymentLinkResult } from './types';

const LINKS_URL = 'https://api.checkout.infinitepay.io/links';
const CHECK_URL = 'https://api.checkout.infinitepay.io/payment_check';

const REQUEST_TIMEOUT_MS = 8_000;

const CHECKOUT_DISABLED = 'external_checkout_not_enabled';

/** InfinitePay bodies and errors never escape this boundary or enter logs. No API key: the handle is the identity. */
export function createInfinitePayClient(request: typeof fetch = globalThis.fetch): PaymentLinkProvider {
  async function post(url: string, body: unknown): Promise<Response> {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  }

  return {
    async createLink(input: PaymentLinkInput): Promise<PaymentLinkResult> {
      try {
        const response = await post(LINKS_URL, {
          handle: input.handle,
          order_nsu: input.orderNsu,
          items: input.items,
          ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
          ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {})
        });
        const body = (await response.json().catch(() => ({}))) as { url?: unknown; error?: unknown; redirect_url?: unknown };

        if (response.status === 404 && body.error === CHECKOUT_DISABLED) {
          return { status: 'checkout_disabled', redirectUrl: typeof body.redirect_url === 'string' ? body.redirect_url : '' };
        }

        if (!response.ok || typeof body.url !== 'string') {
          return { status: 'unavailable' };
        }

        return { status: 'created', url: body.url };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async checkPayment(input: PaymentCheckInput): Promise<PaymentCheckResult> {
      try {
        const response = await post(CHECK_URL, {
          handle: input.handle,
          order_nsu: input.orderNsu,
          transaction_nsu: input.transactionNsu,
          slug: input.slug
        });

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as { success?: unknown; paid?: unknown; amount?: unknown; paid_amount?: unknown; capture_method?: unknown };

        if (body.success !== true || typeof body.paid !== 'boolean') {
          return { status: 'unavailable' };
        }

        return {
          status: 'checked',
          paid: body.paid,
          amountCents: typeof body.amount === 'number' ? body.amount : 0,
          paidAmountCents: typeof body.paid_amount === 'number' ? body.paid_amount : 0,
          captureMethod: typeof body.capture_method === 'string' ? body.capture_method : ''
        };
      } catch {
        return { status: 'unavailable' };
      }
    }
  };
}
