import { randomBytes } from "node:crypto";
import type { Environment, Service } from "@ez4/common";
import type { Factory } from "@ez4/factory";
import { HttpBadRequestError, HttpNotFoundError } from "@ez4/gateway";
import {
  PlanTier,
  type WhatsappGroup,
  WhatsappInstanceState,
  type WhatsappInstanceView,
  WhatsappSender,
} from "@receivy/common";
import { EventRepository } from "../../common/repositories/events";
import { ContactRepository } from "../../contacts/repositories/contact";
import { EventableType } from "../../common/schemas/event";
import type { Db, DbClient } from "../../database";
import type { PlanClient, PlanService } from "../../plans/services/plan";
import { AccountRepository } from "../../users/repositories/account";
import {
  groupHasEveryone,
  parseEvolutionGroups,
} from "../../vendors/whatsapp/groups";
import { toWhatsappNumber } from "../../vendors/whatsapp/phone";
import type { EvolutionConnectionState } from "../../vendors/whatsapp/webhook";
import {
  WhatsappGroupsRequireInstanceError,
  WhatsappInstanceRequiredError,
  WhatsappInstanceUnavailableError,
  WhatsappPlanRequiredError,
} from "../errors";
import { WhatsappInstanceRepository } from "../repositories/whatsapp-instance";
import { pushToUser } from "./direct";
import { type NotificationTransport, notificationTransport } from "./transport";

const REQUEST_TIMEOUT_MS = 15_000;
/** `fetchAllGroups` with participants takes past 15s on a number with many groups; the gateway still cuts at 30s. */
const GROUPS_TIMEOUT_MS = 25_000;

const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPDATE",
];

export type InstanceVariables = {
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  PUBLIC_API_ORIGIN?: string;
  PUBLIC_WEB_ORIGIN?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
  EXPO_ACCESS_TOKEN?: string;
  APP_STAGE?: string;
  EMAIL_TRANSPORT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  MAILPIT_API_URL?: string;
  EMAIL_FILE_DIRECTORY?: string;
};

export type CreateInstanceInput = { riskAccepted: boolean; phone?: string };

export type WhatsappInstanceClient = {
  create(
    ownerId: string,
    input: CreateInstanceInput,
  ): Promise<WhatsappInstanceView>;
  get(ownerId: string, refresh?: boolean): Promise<WhatsappInstanceView | null>;
  remove(ownerId: string): Promise<void>;
  setSender(ownerId: string, sender: WhatsappSender): Promise<WhatsappSender>;
  /** From the Evolution webhook: the instance connected or dropped. */
  applyConnection(
    name: string,
    state: EvolutionConnectionState,
    phone?: string,
    now?: Date,
  ): Promise<void>;
  applyQr(name: string, qr: string, now?: Date): Promise<void>;
  /**
   * The groups the owner's connected number is in. A group with every one of `participantIds` (people
   * from the owner's agenda, matched by phone) is `suggested`, and those come first.
   */
  groups(ownerId: string, participantIds: string[]): Promise<WhatsappGroup[]>;
};

export type InstanceDeps = {
  db: DbClient;
  plans: Pick<PlanClient, "get">;
  variables: InstanceVariables;
  request?: typeof fetch;
  transport?: NotificationTransport;
};

/** The instance is named after the owner: one per account, found from the webhook without a lookup table. */
export function instanceNameOf(ownerId: string): string {
  return `rcv_${ownerId}`;
}

function view(row: WhatsappInstanceRepository.Row): WhatsappInstanceView {
  return {
    state: row.state,
    phone: row.phone ?? null,
    qr: row.qr ?? null,
    pairingCode: row.pairing_code ?? null,
    connectedAt: row.connected_at ?? null,
    disconnectedAt: row.disconnected_at ?? null,
  };
}

type EvolutionApi = { url: string; key: string };

function evolutionOf(variables: InstanceVariables): EvolutionApi | null {
  const url = variables.EVOLUTION_API_URL;
  const key = variables.EVOLUTION_API_KEY;

  if (!url || !key || key === "disabled") {
    return null;
  }

  return { url: url.replace(/\/+$/, ""), key };
}

/** One call with the global key; only instance management goes through here, never a message. */
function call(
  api: EvolutionApi,
  request: typeof fetch,
  method: "POST" | "GET" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  return request(`${api.url}${path}`, {
    method,
    headers: { apikey: api.key, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

type Pairing = { qr?: string; pairingCode?: string };

function pairingOf(body: unknown): Pairing {
  const data = body as {
    base64?: unknown;
    pairingCode?: unknown;
    qrcode?: { base64?: unknown; pairingCode?: unknown };
  } | null;
  const qr = data?.qrcode?.base64 ?? data?.base64;
  const code = data?.qrcode?.pairingCode ?? data?.pairingCode;

  return {
    ...(typeof qr === "string" && qr ? { qr } : {}),
    ...(typeof code === "string" && code ? { pairingCode: code } : {}),
  };
}

/** A fresh QR, and the pairing code when the row has a phone, from Evolution's connect endpoint. */
async function connect(
  api: EvolutionApi,
  request: typeof fetch,
  name: string,
  phone: string | undefined,
): Promise<Pairing> {
  const query = phone ? `?number=${encodeURIComponent(phone)}` : "";
  const response = await call(
    api,
    request,
    "GET",
    `/instance/connect/${encodeURIComponent(name)}${query}`,
  ).catch(() => null);

  if (!response?.ok) {
    return {};
  }

  return pairingOf(await response.json().catch(() => ({})));
}

async function create(
  deps: InstanceDeps,
  request: typeof fetch,
  ownerId: string,
  input: CreateInstanceInput,
): Promise<WhatsappInstanceView> {
  if (input.riskAccepted !== true) {
    throw new HttpBadRequestError(
      "Aceite os termos do canal não oficial para continuar.",
    );
  }

  const phone =
    input.phone === undefined ? undefined : toWhatsappNumber(input.phone);

  if (input.phone !== undefined && !phone) {
    throw new HttpBadRequestError("Telefone inválido.");
  }

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
  const token = randomBytes(32).toString("hex");
  const webhookSecret = randomBytes(24).toString("hex");
  const origin = (
    deps.variables.PUBLIC_API_ORIGIN ??
    "http://127.0.0.1:3735/local-receivy-api"
  ).replace(/\/+$/, "");

  const created = new Date().toISOString();
  // The row and the sender go first, in one transaction: the unique `owner_id` index makes a second
  // concurrent create fail here, before it could delete and recreate the instance the first one made.
  const row = await deps.db.transaction(async (tx) => {
    const inserted = await WhatsappInstanceRepository.insert(tx, {
      ownerId,
      name,
      token,
      webhookSecret,
      ...(phone ? { phone } : {}),
      now: created,
    });

    await AccountRepository.setWhatsappSender(
      tx,
      ownerId,
      WhatsappSender.Own,
      created,
    );

    return inserted;
  });

  // A previous attempt may have created the instance on Evolution and then lost its row (a timeout, a dead
  // database); creating with the same name would otherwise get "name in use" forever. Clearing a possible
  // orphan first costs nothing: a 404 means there was none.
  await call(
    api,
    request,
    "DELETE",
    `/instance/delete/${encodeURIComponent(name)}`,
  ).catch(() => null);

  const response = await call(api, request, "POST", "/instance/create", {
    instanceName: name,
    token,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
    ...(phone ? { number: phone } : {}),
    webhook: {
      url: `${origin}/webhooks/whatsapp/evolution`,
      byEvents: false,
      base64: false,
      headers: { authorization: webhookSecret },
      events: WEBHOOK_EVENTS,
    },
  }).catch(() => null);

  if (!response?.ok) {
    const failed = new Date().toISOString();

    // Nothing to pair: the row and the sender go back to how they were, so a retry starts clean.
    await deps.db.transaction(async (tx) => {
      await WhatsappInstanceRepository.remove(tx, row.id);
      await AccountRepository.setWhatsappSender(
        tx,
        ownerId,
        WhatsappSender.Receivy,
        failed,
      );
    });

    throw new WhatsappInstanceUnavailableError();
  }

  const body = await response.json().catch(() => ({}));
  // Without a phone the QR comes straight from `create`; with one, `connect?number=` hands back both the QR and the pairing
  // code — its fields win when present, but a failed `connect` never discards the QR the `create` body already gave us.
  const pairing = phone
    ? { ...pairingOf(body), ...(await connect(api, request, name, phone)) }
    : pairingOf(body);
  const now = new Date().toISOString();

  await WhatsappInstanceRepository.setState(
    deps.db,
    row.id,
    { qr: pairing.qr ?? null, pairingCode: pairing.pairingCode ?? null },
    now,
  );

  await EventRepository.record(deps.db, {
    type: "whatsapp_instance.created",
    eventableType: EventableType.Account,
    eventableId: ownerId,
    actorId: ownerId,
    payload: { riskAcceptedAt: now, pairing: phone ? "code" : "qr" },
    at: now,
  });

  return view({
    ...row,
    ...(pairing.qr ? { qr: pairing.qr } : {}),
    ...(pairing.pairingCode ? { pairing_code: pairing.pairingCode } : {}),
  });
}

async function get(
  deps: InstanceDeps,
  request: typeof fetch,
  ownerId: string,
  refresh: boolean,
): Promise<WhatsappInstanceView | null> {
  const row = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (!row) {
    return null;
  }

  const api = evolutionOf(deps.variables);

  // A pending instance asked to refresh, or with neither the QR nor the code in hand, asks Evolution for
  // a fresh pair; a failure here just keeps what the row already had.
  if (
    row.state === WhatsappInstanceState.Pending &&
    api &&
    (refresh || (!row.qr && !row.pairing_code))
  ) {
    const pairing = await connect(api, request, row.name, row.phone);

    if (pairing.qr !== undefined || pairing.pairingCode !== undefined) {
      await WhatsappInstanceRepository.setState(
        deps.db,
        row.id,
        { qr: pairing.qr ?? null, pairingCode: pairing.pairingCode ?? null },
        new Date().toISOString(),
      );

      // Mirrors what was just saved: a code-only refresh clears the (now expired) qr, and vice versa.
      return view({
        ...row,
        qr: pairing.qr,
        pairing_code: pairing.pairingCode,
      });
    }
  }

  return view(row);
}

async function setSender(
  deps: InstanceDeps,
  ownerId: string,
  sender: WhatsappSender,
): Promise<WhatsappSender> {
  if (
    sender === WhatsappSender.Own &&
    (await deps.plans.get(ownerId)).plan === PlanTier.Free
  ) {
    throw new WhatsappPlanRequiredError();
  }

  const current = await AccountRepository.whatsappSender(deps.db, ownerId);

  if (
    sender === WhatsappSender.Own &&
    !(await WhatsappInstanceRepository.byOwner(deps.db, ownerId))
  ) {
    throw new WhatsappInstanceRequiredError();
  }

  if (current === sender) {
    return sender;
  }

  const now = new Date().toISOString();

  await deps.db.transaction(async (tx) => {
    await AccountRepository.setWhatsappSender(tx, ownerId, sender, now);
    await EventRepository.record(tx, {
      type: "whatsapp_sender.changed",
      eventableType: EventableType.Account,
      eventableId: ownerId,
      actorId: ownerId,
      payload: { from: current, to: sender },
      at: now,
    });
  });

  return sender;
}

async function remove(
  deps: InstanceDeps,
  request: typeof fetch,
  ownerId: string,
): Promise<void> {
  const row = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (!row) {
    throw new HttpNotFoundError();
  }

  const api = evolutionOf(deps.variables);

  // Best effort on the Evolution side: a 404 means it is already gone; a failure leaves an orphan Evolution can list later.
  if (api) {
    await call(
      api,
      request,
      "DELETE",
      `/instance/logout/${encodeURIComponent(row.name)}`,
    ).catch(() => null);
    await call(
      api,
      request,
      "DELETE",
      `/instance/delete/${encodeURIComponent(row.name)}`,
    ).catch(() => null);
  }

  const now = new Date().toISOString();

  await deps.db.transaction(async (tx) => {
    await WhatsappInstanceRepository.remove(tx, row.id);
    await AccountRepository.setWhatsappSender(
      tx,
      ownerId,
      WhatsappSender.Receivy,
      now,
    );
    await EventRepository.record(tx, {
      type: "whatsapp_instance.removed",
      eventableType: EventableType.Account,
      eventableId: ownerId,
      actorId: ownerId,
      at: now,
    });
  });
}

async function applyConnection(
  deps: InstanceDeps,
  transport: NotificationTransport,
  name: string,
  state: EvolutionConnectionState,
  phone: string | undefined,
  now: Date,
): Promise<void> {
  const row = await WhatsappInstanceRepository.byName(deps.db, name);

  if (!row) {
    return;
  }

  const stamp = now.toISOString();

  if (state === "open") {
    if (row.state === WhatsappInstanceState.Open) {
      return;
    }

    await WhatsappInstanceRepository.setState(
      deps.db,
      row.id,
      {
        state: WhatsappInstanceState.Open,
        qr: null,
        pairingCode: null,
        connectedAt: stamp,
        disconnectedAt: null,
        ...(phone ? { phone } : {}),
      },
      stamp,
    );
    await EventRepository.record(deps.db, {
      type: "whatsapp_instance.opened",
      eventableType: EventableType.Account,
      eventableId: row.owner_id,
      at: stamp,
    });

    return;
  }

  // `connecting` and a repeated `close` say nothing new.
  if (state !== "close" || row.state !== WhatsappInstanceState.Open) {
    return;
  }

  await WhatsappInstanceRepository.setState(
    deps.db,
    row.id,
    { state: WhatsappInstanceState.Closed, disconnectedAt: stamp },
    stamp,
  );
  await EventRepository.record(deps.db, {
    type: "whatsapp_instance.closed",
    eventableType: EventableType.Account,
    eventableId: row.owner_id,
    at: stamp,
  });

  const origin = (
    deps.variables.PUBLIC_WEB_ORIGIN ?? "http://localhost:3000"
  ).replace(/\/+$/, "");

  // One warning per open → closed transition; the reminders that fall meanwhile are reported on their own events.
  await pushToUser(deps.db, transport, row.owner_id, {
    title: "Seu WhatsApp desconectou",
    body: "Os lembretes pelo seu número ficam parados até você conectar de novo.",
    url: `${origin}/settings/reminders`,
  });

  const owner = await AccountRepository.get(deps.db, row.owner_id);
  const to = owner?.verified_email ?? owner?.email;

  if (!to) {
    return;
  }

  await transport.email({
    to,
    key: `whatsapp-instance:${row.id}:closed:${stamp}`,
    subject: "Seu WhatsApp desconectou",
    text: `Os lembretes pelo seu número ficam parados até você conectar de novo no Receivy.\n${origin}/settings/reminders`,
    from: deps.variables.RESEND_FROM_EMAIL ?? "disabled",
  });
}

async function applyQr(
  deps: InstanceDeps,
  name: string,
  qr: string,
  now: Date,
): Promise<void> {
  const row = await WhatsappInstanceRepository.byName(deps.db, name);

  if (!row || row.state !== WhatsappInstanceState.Pending) {
    return;
  }

  await WhatsappInstanceRepository.setState(
    deps.db,
    row.id,
    { qr },
    now.toISOString(),
  );
}

/**
 * Asked with the instance's own token, like a message: the global key only manages instances. Only an
 * open instance can list its groups; anything else is the owner's number not being connected.
 */
async function groups(
  deps: InstanceDeps,
  request: typeof fetch,
  ownerId: string,
  participantIds: string[],
): Promise<WhatsappGroup[]> {
  const row = await WhatsappInstanceRepository.byOwner(deps.db, ownerId);

  if (!row || row.state !== WhatsappInstanceState.Open) {
    throw new WhatsappGroupsRequireInstanceError();
  }

  const base = (
    deps.variables.EVOLUTION_API_URL ?? "http://127.0.0.1:8080"
  ).replace(/\/+$/, "");
  const response = await request(
    `${base}/group/fetchAllGroups/${encodeURIComponent(row.name)}?getParticipants=true`,
    {
      method: "GET",
      headers: { apikey: row.token },
      signal: AbortSignal.timeout(GROUPS_TIMEOUT_MS),
    },
  ).catch(() => null);

  if (!response?.ok) {
    throw new WhatsappInstanceUnavailableError();
  }

  const listed = parseEvolutionGroups(await response.json().catch(() => []));
  const phones = await ContactRepository.phonesOf(
    deps.db,
    ownerId,
    participantIds,
  );
  const people = participantIds.map((id) => phones.get(id) ?? []);

  return listed
    .map((group) => ({
      jid: group.jid,
      name: group.name,
      size: group.size,
      suggested: groupHasEveryone(group, people),
    }))
    .sort(
      (a, b) =>
        Number(b.suggested) - Number(a.suggested) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

/** The client behind the factory and the tests: everything it needs comes in `deps`. */
export function createInstanceClient(
  deps: InstanceDeps,
): WhatsappInstanceClient {
  const request = deps.request ?? globalThis.fetch;
  const transport =
    deps.transport ?? notificationTransport({ ...deps.variables });

  return {
    create: (ownerId, input) => create(deps, request, ownerId, input),
    get: (ownerId, refresh = false) => get(deps, request, ownerId, refresh),
    remove: (ownerId) => remove(deps, request, ownerId),
    setSender: (ownerId, sender) => setSender(deps, ownerId, sender),
    applyConnection: (name, state, phone, now = new Date()) =>
      applyConnection(deps, transport, name, state, phone, now),
    applyQr: (name, qr, now = new Date()) => applyQr(deps, name, qr, now),
    groups: (ownerId, participantIds) =>
      groups(deps, request, ownerId, participantIds),
  };
}

export declare class WhatsappInstanceService extends Factory.Service<WhatsappInstanceClient> {
  handler: typeof createService;

  variables: {
    EVOLUTION_API_URL: Environment.VariableOrValue<
      "EVOLUTION_API_URL",
      "http://127.0.0.1:8080"
    >;
    EVOLUTION_API_KEY: Environment.VariableOrValue<
      "EVOLUTION_API_KEY",
      "disabled"
    >;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<
      "PUBLIC_API_ORIGIN",
      "http://127.0.0.1:3735/local-receivy-api"
    >;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<
      "PUBLIC_WEB_ORIGIN",
      "http://localhost:3000"
    >;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<
      "NOTIFICATION_PUSH_TRANSPORT",
      "disabled"
    >;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<
      "EXPO_ACCESS_TOKEN",
      "disabled"
    >;
    APP_STAGE: Environment.Variable<"APP_STAGE">;
    EMAIL_TRANSPORT: Environment.Variable<"EMAIL_TRANSPORT">;
    RESEND_API_KEY: Environment.Variable<"RESEND_API_KEY">;
    RESEND_FROM_EMAIL: Environment.VariableOrValue<
      "RESEND_FROM_EMAIL",
      "disabled"
    >;
    MAILPIT_API_URL: Environment.VariableOrValue<
      "MAILPIT_API_URL",
      "http://127.0.0.1:8025"
    >;
    EMAIL_FILE_DIRECTORY: Environment.VariableOrValue<
      "EMAIL_FILE_DIRECTORY",
      ".ez4/emails"
    >;
  };

  services: {
    db: Environment.Service<Db>;
    plans: Environment.Service<PlanService>;
    variables: Environment.ServiceVariables;
  };
}

export function createService({
  db,
  plans,
  variables,
}: Service.Context<WhatsappInstanceService>): WhatsappInstanceClient {
  return createInstanceClient({ db, plans, variables });
}
