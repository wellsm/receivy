import { randomBytes } from 'node:crypto';
import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpNotFoundError } from '@ez4/gateway';
import { PlanTier, WhatsappInstanceState, type WhatsappInstanceView, WhatsappSender } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { Db, DbClient } from '../../database';
import type { PlanClient, PlanService } from '../../plans/services/plan';
import { AccountRepository } from '../../users/repositories/account';
import type { EvolutionConnectionState } from '../../vendors/whatsapp/webhook';
import { WhatsappInstanceUnavailableError, WhatsappPlanRequiredError } from '../errors';
import { WhatsappInstanceRepository } from '../repositories/whatsapp-instance';
import { pushToUser } from './direct';
import { type NotificationTransport, notificationTransport } from './transport';

const REQUEST_TIMEOUT_MS = 15_000;

const WEBHOOK_EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'];

export type InstanceVariables = {
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  PUBLIC_API_ORIGIN?: string;
  PUBLIC_WEB_ORIGIN?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
  EXPO_ACCESS_TOKEN?: string;
};

export type WhatsappInstanceClient = {
  create(ownerId: string): Promise<WhatsappInstanceView>;
  get(ownerId: string): Promise<WhatsappInstanceView | null>;
  remove(ownerId: string): Promise<void>;
  /** From the Evolution webhook: the instance connected or dropped. */
  applyConnection(name: string, state: EvolutionConnectionState, phone?: string, now?: Date): Promise<void>;
  applyQr(name: string, qr: string, now?: Date): Promise<void>;
};

export type InstanceDeps = {
  db: DbClient;
  plans: Pick<PlanClient, 'get'>;
  variables: InstanceVariables;
  request?: typeof fetch;
  transport?: NotificationTransport;
};

/** The instance is named after the owner: one per account, found from the webhook without a lookup table. */
export function instanceNameOf(ownerId: string): string {
  return `rcv_${ownerId}`;
}

function view(row: WhatsappInstanceRepository.Row): WhatsappInstanceView {
  return { state: row.state, phone: row.phone ?? null, qr: row.qr ?? null, connectedAt: row.connected_at ?? null };
}

type EvolutionApi = { url: string; key: string };

function evolutionOf(variables: InstanceVariables): EvolutionApi | null {
  const url = variables.EVOLUTION_API_URL;
  const key = variables.EVOLUTION_API_KEY;

  if (!url || !key || key === 'disabled') {
    return null;
  }

  return { url: url.replace(/\/+$/, ''), key };
}

/** One call with the global key; only instance management goes through here, never a message. */
function call(api: EvolutionApi, request: typeof fetch, method: 'POST' | 'GET' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  return request(`${api.url}${path}`, {
    method,
    headers: { apikey: api.key, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

function qrOf(body: unknown): string | undefined {
  const qr = (body as { qrcode?: { base64?: unknown } } | null)?.qrcode?.base64;

  return typeof qr === 'string' && qr ? qr : undefined;
}

async function create(deps: InstanceDeps, request: typeof fetch, ownerId: string): Promise<WhatsappInstanceView> {
  const api = evolutionOf(deps.variables);

  if (!api) {
    throw new WhatsappInstanceUnavailableError();
  }

  const existing = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (existing) {
    return view(existing);
  }

  const summary = await deps.plans.get(ownerId);

  if (summary.plan === PlanTier.Free) {
    throw new WhatsappPlanRequiredError();
  }

  const name = instanceNameOf(ownerId);
  const token = randomBytes(32).toString('hex');
  const webhookSecret = randomBytes(24).toString('hex');
  const origin = (deps.variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, '');
  const response = await call(api, request, 'POST', '/instance/create', {
    instanceName: name,
    token,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: { url: `${origin}/webhooks/whatsapp/evolution`, byEvents: false, base64: false, headers: { authorization: webhookSecret }, events: WEBHOOK_EVENTS }
  }).catch(() => null);

  if (!response?.ok) {
    throw new WhatsappInstanceUnavailableError();
  }

  const body = await response.json().catch(() => ({}));
  const now = new Date().toISOString();
  const row = await WhatsappInstanceRepository.insert(deps.db, { ownerId, name, token, webhookSecret, qr: qrOf(body), now });

  await AccountRepository.setWhatsappSender(deps.db, ownerId, WhatsappSender.Own, now);
  await EventRepository.record(deps.db, { type: 'whatsapp_instance.created', eventableType: EventableType.Account, eventableId: ownerId, actorId: ownerId, at: now });

  return view(row);
}

async function get(deps: InstanceDeps, request: typeof fetch, ownerId: string): Promise<WhatsappInstanceView | null> {
  const row = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (!row) {
    return null;
  }

  const api = evolutionOf(deps.variables);

  // A pending instance with no QR in hand asks Evolution for a fresh one; a failure here just shows none.
  if (row.state === WhatsappInstanceState.Pending && !row.qr && api) {
    const response = await call(api, request, 'GET', `/instance/connect/${encodeURIComponent(row.name)}`).catch(() => null);
    const qr = response?.ok ? qrOf({ qrcode: await response.json().catch(() => ({})) }) : undefined;

    if (qr) {
      await WhatsappInstanceRepository.setState(deps.db, row.id, { qr }, new Date().toISOString());

      return view({ ...row, qr });
    }
  }

  return view(row);
}

async function remove(deps: InstanceDeps, request: typeof fetch, ownerId: string): Promise<void> {
  const row = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (!row) {
    throw new HttpNotFoundError();
  }

  const api = evolutionOf(deps.variables);

  // Best effort on the Evolution side: a 404 means it is already gone; a failure leaves an orphan Evolution can list later.
  if (api) {
    await call(api, request, 'DELETE', `/instance/logout/${encodeURIComponent(row.name)}`).catch(() => null);
    await call(api, request, 'DELETE', `/instance/delete/${encodeURIComponent(row.name)}`).catch(() => null);
  }

  const now = new Date().toISOString();

  await WhatsappInstanceRepository.remove(deps.db, row.id);
  await AccountRepository.setWhatsappSender(deps.db, ownerId, WhatsappSender.Receivy, now);
  await EventRepository.record(deps.db, { type: 'whatsapp_instance.removed', eventableType: EventableType.Account, eventableId: ownerId, actorId: ownerId, at: now });
}

async function applyConnection(deps: InstanceDeps, transport: NotificationTransport, name: string, state: EvolutionConnectionState, phone: string | undefined, now: Date): Promise<void> {
  const row = await WhatsappInstanceRepository.byName(deps.db, name);

  if (!row) {
    return;
  }

  const stamp = now.toISOString();

  if (state === 'open') {
    if (row.state === WhatsappInstanceState.Open) {
      return;
    }

    await WhatsappInstanceRepository.setState(deps.db, row.id, { state: WhatsappInstanceState.Open, qr: null, connectedAt: stamp, disconnectedAt: null, ...(phone ? { phone } : {}) }, stamp);
    await EventRepository.record(deps.db, { type: 'whatsapp_instance.opened', eventableType: EventableType.Account, eventableId: row.owner_id, at: stamp });

    return;
  }

  // `connecting` and a repeated `close` say nothing new.
  if (state !== 'close' || row.state !== WhatsappInstanceState.Open) {
    return;
  }

  await WhatsappInstanceRepository.setState(deps.db, row.id, { state: WhatsappInstanceState.Closed, disconnectedAt: stamp }, stamp);
  await EventRepository.record(deps.db, { type: 'whatsapp_instance.closed', eventableType: EventableType.Account, eventableId: row.owner_id, at: stamp });

  const origin = (deps.variables.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');

  // One warning per open → closed transition; the reminders that fall meanwhile are reported on their own events.
  await pushToUser(deps.db, transport, row.owner_id, {
    title: 'Seu WhatsApp desconectou',
    body: 'Os lembretes pelo seu número ficam parados até você conectar de novo.',
    url: `${origin}/settings/reminders`
  });
}

async function applyQr(deps: InstanceDeps, name: string, qr: string, now: Date): Promise<void> {
  const row = await WhatsappInstanceRepository.byName(deps.db, name);

  if (!row || row.state !== WhatsappInstanceState.Pending) {
    return;
  }

  await WhatsappInstanceRepository.setState(deps.db, row.id, { qr }, now.toISOString());
}

/** The client behind the factory and the tests: everything it needs comes in `deps`. */
export function createInstanceClient(deps: InstanceDeps): WhatsappInstanceClient {
  const request = deps.request ?? globalThis.fetch;
  const transport = deps.transport ?? notificationTransport({ ...deps.variables });

  return {
    create: (ownerId) => create(deps, request, ownerId),
    get: (ownerId) => get(deps, request, ownerId),
    remove: (ownerId) => remove(deps, request, ownerId),
    applyConnection: (name, state, phone, now = new Date()) => applyConnection(deps, transport, name, state, phone, now),
    applyQr: (name, qr, now = new Date()) => applyQr(deps, name, qr, now)
  };
}

export declare class WhatsappInstanceService extends Factory.Service<WhatsappInstanceClient> {
  handler: typeof createService;

  variables: {
    EVOLUTION_API_URL: Environment.VariableOrValue<'EVOLUTION_API_URL', 'http://127.0.0.1:8080'>;
    EVOLUTION_API_KEY: Environment.VariableOrValue<'EVOLUTION_API_KEY', 'disabled'>;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };

  services: {
    db: Environment.Service<Db>;
    plans: Environment.Service<PlanService>;
    variables: Environment.ServiceVariables;
  };
}

export function createService({ db, plans, variables }: Service.Context<WhatsappInstanceService>): WhatsappInstanceClient {
  return createInstanceClient({ db, plans, variables });
}
