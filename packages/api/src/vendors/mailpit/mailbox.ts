import { setTimeout as delay } from 'node:timers/promises';
import { getBaseUrl } from './service';

/**
 * Read side of the local Mailpit mailbox, for smoke and integration checks.
 * Test-only: it never runs in a deployed stage and fails loudly on any API error.
 */
export type MailboxMessage = {
  id: string;
  subject: string;
  from: string;
  to: string[];
  snippet: string;
  created: string;
};

export type MailboxWaitOptions = {
  timeout?: number;
  interval?: number;
};

export interface MailpitMailbox {
  clear(): Promise<void>;
  search(query: string, limit?: number): Promise<MailboxMessage[]>;
  waitFor(query: string, options?: MailboxWaitOptions): Promise<MailboxMessage>;
  text(id: string): Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_INTERVAL_MS = 250;

export const createMailpitMailbox = (url?: string, request: typeof fetch = globalThis.fetch): MailpitMailbox => {
  const baseUrl = getBaseUrl(url ?? process.env.MAILPIT_API_URL);

  const call = async (path: string, init?: RequestInit) => {
    const response = await request(`${baseUrl}${path}`, init);

    if (!response.ok) {
      throw new Error(`Mailpit request failed with status ${response.status}.`);
    }

    return response;
  };

  const search = async (query: string, limit = 50) => {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const response = await call(`/api/v1/search?${params}`);
    const body = (await response.json()) as { messages?: RawMessage[] };

    return (body.messages ?? []).map(toMessage);
  };

  return {
    search,

    clear: async () => {
      await call('/api/v1/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [] })
      });
    },

    text: async (id: string) => {
      const response = await call(`/api/v1/message/${encodeURIComponent(id)}`);
      const body = (await response.json()) as { Text?: string };

      return body.Text ?? '';
    },

    waitFor: async (query: string, options?: MailboxWaitOptions) => {
      const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
      const interval = options?.interval ?? DEFAULT_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      for (;;) {
        const [message] = await search(query, 1);

        if (message) {
          return message;
        }

        if (Date.now() >= deadline) {
          throw new Error(`No Mailpit message matched '${query}' within ${timeout}ms.`);
        }

        await delay(interval);
      }
    }
  };
};

type RawAddress = {
  Name?: string;
  Address?: string;
};

type RawMessage = {
  ID: string;
  Subject?: string;
  From?: RawAddress | null;
  To?: RawAddress[] | null;
  Snippet?: string;
  Created?: string;
};

const toMessage = (message: RawMessage): MailboxMessage => {
  return {
    id: message.ID,
    subject: message.Subject ?? '',
    from: message.From?.Address ?? '',
    to: (message.To ?? []).map((address) => address.Address ?? ''),
    snippet: message.Snippet ?? '',
    created: message.Created ?? ''
  };
};
