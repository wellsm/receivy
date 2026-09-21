import type { Client, Cron } from '@ez4/scheduler';
import { PaymentProvider } from '@receivy/common';
import type { NotificationConfig } from '../../src/notifications/services/planner';
import type { ChargeNotifyEvent, NoticeContext } from '../../src/notifications/services/send';
import type { NotificationTransport } from '../../src/notifications/services/transport';
import { fakeCheckout } from '../../src/vendors/checkout/fake';

export type ScheduledEvent<T> = { date: Date; event: T };

/** In-memory stand-in for a dynamic EZ4 scheduler: remembers the last event per identifier. */
export function fakeScheduler<T extends Cron.Event>() {
  const events = new Map<string, ScheduledEvent<T>>();

  const client: Client<T> & { events: Map<string, ScheduledEvent<T>> } = {
    events,
    getEvent: async (identifier) => events.get(identifier),
    setEvent: async (identifier, input) => {
      events.set(identifier, { date: input.date, event: input.event });
    },
    createEvent: async (identifier, input) => {
      events.set(identifier, { date: input.date, event: input.event });
    },
    updateEvent: async (identifier, input) => {
      const current = events.get(identifier);

      if (current) {
        events.set(identifier, { date: input.date ?? current.date, event: input.event ?? current.event });
      }
    },
    deleteEvent: async (identifier) => events.delete(identifier)
  };

  return client;
}

export type SentPush = { token: string; title: string; body: string; url: string };
export type SentEmail = { to: string; key: string; subject: string; text: string; from: string };

/** Records every send; `pushStatus`/`emailStatus` let a test simulate a dead device or a disabled channel. */
export function fakeTransport() {
  const pushes: SentPush[] = [];
  const emails: SentEmail[] = [];
  const state = {
    pushStatus: 'accepted' as 'accepted' | 'device_unregistered' | 'disabled',
    emailStatus: 'accepted' as 'accepted' | 'disabled'
  };

  const transport: NotificationTransport = {
    push: async (input) => {
      pushes.push(input);

      return state.pushStatus === 'accepted' ? { status: 'accepted', id: `ticket-${pushes.length}` } : { status: state.pushStatus };
    },
    email: async (input) => {
      emails.push(input);

      return state.emailStatus === 'accepted' ? { status: 'accepted', id: `email-${emails.length}` } : { status: state.emailStatus };
    },
    receipt: async () => ({ status: 'delivered' })
  };

  return {
    transport,
    pushes,
    emails,
    state,
    reset: () => {
      pushes.length = 0;
      emails.length = 0;
    }
  };
}

export const TEST_CONFIG: NotificationConfig = {
  publicOrigin: 'https://receivy.example',
  apiOrigin: 'https://api.receivy.example',
  secret: 'notification-test-secret-with-enough-entropy',
  credentialKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  from: 'fixture@example.invalid',
  pushAvailable: true,
  whatsappAvailable: false
};

/** A full producer context on fakes; every spec that creates charges can pass one and inspect the fakes. */
export function fakeNotice(config: Partial<NotificationConfig> = {}) {
  const sent = fakeTransport();
  const notify = fakeScheduler<ChargeNotifyEvent>();
  const context: NoticeContext = {
    config: { ...TEST_CONFIG, ...config },
    transport: sent.transport,
    links: {
      [PaymentProvider.InfinitePay]: fakeCheckout('https://receivy.example', PaymentProvider.InfinitePay),
      [PaymentProvider.PagSeguro]: fakeCheckout('https://receivy.example', PaymentProvider.PagSeguro)
    }
  };

  return { context, sent, notify };
}
