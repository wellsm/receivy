import type { PagSeguroCheckoutInput, PagSeguroCheckoutResult, PagSeguroClient, PagSeguroInactivateResult, PagSeguroOrderResult, PagSeguroVerifyResult } from './types';
export { PagSeguroHost } from './types';

const REQUEST_TIMEOUT_MS = 8_000;
const DESCRIPTION_MAX = 100;
const PROBE_CHECKOUT = 'CHEC_00000000-0000-0000-0000-000000000000';

/** PagBank bodies and errors never escape this boundary or enter logs; the token only travels in the header. */
export function createPagSeguroClient(host: string, request: typeof fetch = globalThis.fetch): PagSeguroClient {
  const base = host.replace(/\/+$/, '');

  async function call(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    return request(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  }

  return {
    async verifyToken(token): Promise<PagSeguroVerifyResult> {
      try {
        const response = await call(token, 'GET', `/checkouts/${PROBE_CHECKOUT}`);

        if (response.status === 401) {
          return { status: 'invalid' };
        }

        if (response.status === 404 || response.ok) {
          return { status: 'valid' };
        }

        return { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async createCheckout(token: string, input: PagSeguroCheckoutInput): Promise<PagSeguroCheckoutResult> {
      try {
        const response = await call(token, 'POST', '/checkouts', {
          reference_id: input.referenceId,
          expiration_date: input.expiresAt,
          customer_modifiable: true,
          items: [{ reference_id: input.referenceId, name: input.description.slice(0, DESCRIPTION_MAX), quantity: 1, unit_amount: input.amountCents }],
          payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
          soft_descriptor: 'Receivy',
          redirect_url: input.redirectUrl,
          notification_urls: [input.webhookUrl]
        });

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as { id?: unknown; links?: { rel?: unknown; href?: unknown }[] };
        const pay = Array.isArray(body.links) ? body.links.find((link) => link.rel === 'PAY') : undefined;

        if (typeof body.id !== 'string' || typeof pay?.href !== 'string') {
          return { status: 'unavailable' };
        }

        return { status: 'created', id: body.id, url: pay.href };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async getOrder(token, orderId): Promise<PagSeguroOrderResult> {
      try {
        const response = await call(token, 'GET', `/orders/${encodeURIComponent(orderId)}`);

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        if (!response.ok) {
          return { status: 'unavailable' };
        }

        const body = (await response.json().catch(() => ({}))) as {
          reference_id?: unknown;
          charges?: { id?: unknown; status?: unknown; amount?: { value?: unknown; summary?: { paid?: unknown } }; payment_method?: { type?: unknown } }[];
        };
        const charges = (Array.isArray(body.charges) ? body.charges : []).map((charge) => ({
          id: typeof charge.id === 'string' ? charge.id : '',
          status: typeof charge.status === 'string' ? charge.status : '',
          amountCents: typeof charge.amount?.value === 'number' ? charge.amount.value : 0,
          paidCents: typeof charge.amount?.summary?.paid === 'number' ? charge.amount.summary.paid : 0,
          method: typeof charge.payment_method?.type === 'string' ? charge.payment_method.type : ''
        }));

        return { status: 'found', referenceId: typeof body.reference_id === 'string' ? body.reference_id : undefined, charges };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async inactivate(token, checkoutId): Promise<PagSeguroInactivateResult> {
      try {
        const response = await call(token, 'POST', `/checkouts/${encodeURIComponent(checkoutId)}/inactivate`);

        if (response.status === 401) {
          return { status: 'unauthorized' };
        }

        return response.ok ? { status: 'done' } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    }
  };
}
