import { WhatsappMessageStatus } from '@receivy/common';

export type MetaStatusUpdate = { providerMessageId: string; status: WhatsappMessageStatus; error?: string };

const META_STATUSES: Record<string, WhatsappMessageStatus> = {
  sent: WhatsappMessageStatus.Sent,
  delivered: WhatsappMessageStatus.Delivered,
  read: WhatsappMessageStatus.Read,
  failed: WhatsappMessageStatus.Failed
};

const FAILED_WITHOUT_ERROR = 'Meta reported the message as failed without an error.';

type MetaStatus = { id?: unknown; status?: unknown; errors?: unknown };
// `template_statuses` is what the whap fake sends in place of the real Cloud API's `statuses`.
type MetaChange = { field?: unknown; value?: { statuses?: unknown; template_statuses?: unknown } | null };

/** The list, or an empty one: the body is signed, but the Graph API shape drifts between versions and must not 500. */
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function describeFailure(errors: unknown): string {
  const [first] = listOf(errors) as ({ code?: unknown; title?: unknown; message?: unknown } | null)[];

  if (!first || typeof first.code !== 'number') {
    return FAILED_WITHOUT_ERROR;
  }

  const detail = typeof first.message === 'string' ? first.message : first.title;

  return typeof detail === 'string' ? `${first.code}: ${detail}` : String(first.code);
}

function toMetaUpdate(raw: unknown): MetaStatusUpdate | null {
  const item = raw as MetaStatus | null;
  const status = typeof item?.status === 'string' ? META_STATUSES[item.status] : undefined;

  if (!item || typeof item.id !== 'string' || !item.id || !status) {
    return null;
  }

  if (status === WhatsappMessageStatus.Failed) {
    return { providerMessageId: item.id, status, error: describeFailure(item.errors) };
  }

  return { providerMessageId: item.id, status };
}

/** The status notices of one webhook POST, in order. Only `field: 'messages'` carries them; incoming messages are ignored. */
export function parseMetaStatuses(payload: unknown): MetaStatusUpdate[] {
  const updates: MetaStatusUpdate[] = [];

  for (const entry of listOf((payload as { entry?: unknown } | null)?.entry)) {
    for (const change of listOf((entry as { changes?: unknown } | null)?.changes) as (MetaChange | null)[]) {
      if (change?.field !== 'messages') {
        continue;
      }

      for (const raw of [...listOf(change.value?.statuses), ...listOf(change.value?.template_statuses)]) {
        const update = toMetaUpdate(raw);

        if (update) {
          updates.push(update);
        }
      }
    }
  }

  return updates;
}

export type EvolutionConnectionState = 'open' | 'close' | 'connecting';

export type EvolutionEvent =
  | { kind: 'connection'; instance: string; state: EvolutionConnectionState; phone?: string }
  | { kind: 'status'; instance: string; providerMessageId: string; status: WhatsappMessageStatus }
  | { kind: 'qr'; instance: string; qr: string };

/** Evolution's message acks; `PENDING` says nothing new and is dropped. */
const EVOLUTION_STATUSES: Record<string, WhatsappMessageStatus> = {
  SERVER_ACK: WhatsappMessageStatus.Sent,
  DELIVERY_ACK: WhatsappMessageStatus.Delivered,
  READ: WhatsappMessageStatus.Read,
  PLAYED: WhatsappMessageStatus.Read,
  ERROR: WhatsappMessageStatus.Failed
};

type EvolutionPayload = { event?: unknown; instance?: unknown; data?: Record<string, unknown> | null };

export function evolutionInstanceOf(payload: unknown): string | null {
  const instance = (payload as EvolutionPayload | null)?.instance;

  return typeof instance === 'string' && instance ? instance : null;
}

/** Digits before the `@` of a WhatsApp JID (`5511999999999@s.whatsapp.net`). */
function phoneOfJid(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const digits = value.split('@')[0]?.replace(/\D/g, '');

  return digits || undefined;
}

export function parseEvolutionEvent(payload: unknown): EvolutionEvent | null {
  const body = payload as EvolutionPayload | null;
  const instance = evolutionInstanceOf(body);
  const data = body?.data ?? null;

  if (!instance || typeof body?.event !== 'string' || !data || typeof data !== 'object') {
    return null;
  }

  if (body.event === 'connection.update') {
    const state = data['state'];

    if (state !== 'open' && state !== 'close' && state !== 'connecting') {
      return null;
    }

    const phone = phoneOfJid(data['wuid']);

    return { kind: 'connection', instance, state, ...(phone ? { phone } : {}) };
  }

  if (body.event === 'messages.update') {
    const key = data['key'] as { id?: unknown } | undefined;
    const id = typeof data['keyId'] === 'string' ? data['keyId'] : typeof key?.id === 'string' ? key.id : null;
    const status = typeof data['status'] === 'string' ? EVOLUTION_STATUSES[data['status']] : undefined;

    if (!id || !status) {
      return null;
    }

    return { kind: 'status', instance, providerMessageId: id, status };
  }

  if (body.event === 'qrcode.updated') {
    const qr = (data['qrcode'] as { base64?: unknown } | undefined)?.base64;

    if (typeof qr !== 'string' || !qr) {
      return null;
    }

    return { kind: 'qr', instance, qr };
  }

  return null;
}
