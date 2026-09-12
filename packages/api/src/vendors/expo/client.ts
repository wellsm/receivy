import type { ReceiptResult, SendResult } from '../../notifications/services/transport';
import type { ExpoPushMessage, ExpoReceiptResponse, ExpoTicketResponse } from './types';
import { expoError, httpFailure } from './utils';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export interface ExpoPushClient {
  send(input: ExpoPushMessage): Promise<SendResult>;
  receipt(ticket: string): Promise<ReceiptResult>;
}

/** Expo bodies/errors never escape this boundary or enter logs. */
export function createExpoPushClient(env: Record<string, string | undefined>, request: typeof fetch): ExpoPushClient {
  const headers = {
    'Content-Type': 'application/json',
    ...(env.EXPO_ACCESS_TOKEN && env.EXPO_ACCESS_TOKEN !== 'disabled' ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {})
  };

  async function post(url: string, body: unknown) {
    return request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
  }

  return {
    async send(input) {
      try {
        const response = await post(SEND_URL, {
          to: input.token,
          title: input.title,
          body: input.body,
          data: { url: input.url },
          sound: 'default'
        });

        if (!response.ok) {
          return { status: httpFailure(response.status) };
        }

        const body = (await response.json()) as ExpoTicketResponse;

        if (body.data?.status === 'ok' && typeof body.data.id === 'string') {
          return { status: 'accepted', id: body.data.id };
        }

        return body.data?.status === 'error' ? { status: expoError(body.data.details?.error) } : { status: 'uncertain' };
      } catch {
        return { status: 'uncertain' };
      }
    },
    async receipt(ticket) {
      try {
        const response = await post(RECEIPTS_URL, { ids: [ticket] });

        // A failed query says nothing about delivery of the already accepted push.
        if (!response.ok) {
          return { status: httpFailure(response.status) === 'transient' ? 'transient' : 'observation_failed' };
        }

        const body = (await response.json()) as ExpoReceiptResponse;
        const receipt = body.data?.[ticket];

        if (!receipt) {
          return { status: 'pending' };
        }

        if (receipt.status === 'ok') {
          return { status: 'delivered' };
        }

        return receipt.status === 'error' ? { status: expoError(receipt.details?.error) } : { status: 'observation_failed' };
      } catch {
        return { status: 'transient' };
      }
    }
  };
}
