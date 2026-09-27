"use client";

import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings, chargeDateText } from "@receivy/common";
import { Unplug } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type WhatsappClient, whatsappClient } from "@/lib/whatsapp-client";
import { evolutionEnabled, receivyEnabled, whatsappEnabled } from "@/lib/whatsapp-flag";

type Props = { client?: WhatsappClient };

async function loadPlan(): Promise<PlanTier> {
  const response = await browserFetch("/api/financial/plan");

  if (!response.ok) {
    return PlanTier.Free;
  }

  return ((await response.json()) as { plan: PlanTier }).plan;
}

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;

  return (
    <div role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

type SenderCardProps = {
  value: WhatsappSender;
  selected: WhatsappSender;
  disabled: boolean;
  /** "Em breve" tag text when the flag is on but the API capability for this sender is off; null otherwise. */
  lockedTag?: string | null;
  title: string;
  /** Roving tabindex: 0 for the checked (or first enabled) card in the radiogroup, -1 for the other. */
  tabIndex: number;
  cardRef: RefObject<HTMLDivElement | null>;
  onSelect: (sender: WhatsappSender) => void;
  onArrow: (direction: 1 | -1) => void;
  children: ReactNode;
};

function LockedTag({ children }: { children: ReactNode }) {
  return <span className="ml-auto rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{children}</span>;
}

/** The radio is the header only; the body is its sibling, so its buttons and checkbox stay reachable on their own. */
function SenderCard({ value, selected, disabled, lockedTag = null, title, tabIndex, cardRef, onSelect, onArrow, children }: SenderCardProps) {
  const active = value === selected;

  function select() {
    if (disabled) {
      return;
    }

    onSelect(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();

      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      onArrow(-1);

      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      onArrow(1);
    }
  }

  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-4 ${active ? "border-primary" : "border-outline"} ${disabled ? "opacity-60" : ""}`}>
      <div
        ref={cardRef}
        role="radio"
        aria-checked={active}
        aria-disabled={disabled}
        aria-label={title}
        tabIndex={tabIndex}
        onClick={select}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-3 rounded-lg ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span aria-hidden className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-primary" : "border-outline"}`}>
          {active ? <span className="size-2 rounded-full bg-primary" /> : null}
        </span>
        <p className="m-0 font-semibold text-ink">{title}</p>
        {lockedTag ? <LockedTag>{lockedTag}</LockedTag> : null}
      </div>
      {children}
    </div>
  );
}

export const POLL_MS = 5000;

const RISK_POINTS = [
  'Canal não oficial: seu WhatsApp fica ligado ao Receivy como um "dispositivo conectado".',
  "A Meta pode bloquear o seu número, e o Receivy não tem como reverter.",
  "Sem garantia de entrega e sem cota: a mensagem vai como texto simples.",
  "Se o celular desconectar, os lembretes por WhatsApp param até você conectar de novo. Você é avisado por push e e-mail.",
];

type OwnProps = { settings: WhatsappSettings | null; client: WhatsappClient; onChange: (settings: WhatsappSettings) => void; disabled: boolean };

function OwnNumberCard({ settings, client, onChange, disabled }: OwnProps) {
  const instance = settings?.instance ?? null;
  const [accepted, setAccepted] = useState(false);
  const [byCode, setByCode] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    (next: WhatsappInstanceView | null, forceSender?: WhatsappSender) => {
      if (!settings) {
        return;
      }

      // The API sets the sender on POST (create) and DELETE, never on GET; mirror only those two —
      // a poll (or a manual "Gerar novo" refresh) leaves whatever sender is already in `settings`.
      const sender = next === null ? WhatsappSender.Receivy : (forceSender ?? settings.sender);

      onChange({ ...settings, instance: next, sender });
    },
    [onChange, settings],
  );

  // `patch` is recreated on every poll (it closes over `settings`); keep the latest one in a ref so the
  // polling interval below is set up once per pending run instead of being torn down on every tick.
  const patchRef = useRef(patch);

  useEffect(() => {
    patchRef.current = patch;
  });

  // Bumped by every user action (connect/refresh/disconnect/reconnect) and by the poll effect's own
  // cleanup, so a poll answered after the user has already moved on gets ignored instead of patching
  // stale state back in (e.g. a slow poll resolving with a QR after "Cancelar" already deleted it).
  const seqRef = useRef(0);

  // Poll while pending; the interval dies with the card or when the state moves on.
  useEffect(() => {
    if (instance?.state !== WhatsappInstanceState.Pending) {
      return;
    }

    let cancelled = false;

    const timer = setInterval(() => {
      const seq = seqRef.current;

      client
        .instance()
        .then((next) => {
          if (cancelled || seqRef.current !== seq) {
            return;
          }

          patchRef.current(next);
        })
        .catch(() => {
          // A failed poll is just the next tick's problem.
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      seqRef.current += 1;
      clearInterval(timer);
    };
  }, [client, instance?.state]);

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);

    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);

      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    seqRef.current += 1;

    const next = await run(() => client.connect({ riskAccepted: true, ...(byCode && phone ? { phone } : {}) }), "Não deu para conectar agora.");

    if (next) {
      patch(next, WhatsappSender.Own);
    }
  }

  async function refresh() {
    seqRef.current += 1;

    const next = await run(() => client.instance(true), "Não deu para gerar um novo código.");

    if (next) {
      patch(next);
    }
  }

  async function disconnect() {
    seqRef.current += 1;
    setConfirming(false);

    const done = await run(() => client.disconnect().then(() => true), "Não deu para desconectar agora.");

    if (done) {
      patch(null);
    }
  }

  async function reconnect() {
    seqRef.current += 1;

    const done = await run(() => client.disconnect().then(() => true), "Não deu para desconectar agora.");

    if (done) {
      setAccepted(true);
      patch(null);
    }
  }

  const alert = error ? (
    <p role="alert" className="m-0 text-sm text-danger">
      {error}
    </p>
  ) : null;

  let body: ReactNode;

  if (instance?.state === WhatsappInstanceState.Open) {
    body = (
      <>
        <p className="m-0 text-sm text-ink">
          {`Conectado ao ${maskPhone(instance.phone)}`}
          {instance.connectedAt ? ` · desde ${chargeDateText(instance.connectedAt.slice(0, 10))}` : ""}
        </p>
        <button type="button" className="text-sm text-danger underline" disabled={busy} onClick={() => setConfirming(true)}>
          Desconectar
        </button>
        {alert}
        {confirming ? (
          <ConfirmDialog
            title="Desconectar seu número?"
            subtitle="Os lembretes voltam a sair pelo número do Receivy."
            icon={Unplug}
            confirmLabel="Desconectar"
            busy={busy}
            onConfirm={() => void disconnect()}
            onCancel={() => setConfirming(false)}
          />
        ) : null}
      </>
    );
  } else if (instance?.state === WhatsappInstanceState.Closed) {
    body = (
      <>
        <p role="status" className="m-0 text-sm text-danger">
          {`Seu número desconectou${instance.disconnectedAt ? ` em ${chargeDateText(instance.disconnectedAt.slice(0, 10))}` : ""}. Os lembretes por WhatsApp estão parados.`}
        </p>
        <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary" disabled={busy} onClick={() => void reconnect()}>
          Reconectar
        </button>
        {alert}
      </>
    );
  } else if (instance?.state === WhatsappInstanceState.Pending) {
    body = (
      <>
        {instance.pairingCode ? (
          <>
            <p className="m-0 text-2xl font-mono tracking-widest">{instance.pairingCode}</p>
            <p className="m-0 text-xs text-muted">No celular: WhatsApp › Dispositivos conectados › Conectar dispositivo › Conectar com número de telefone.</p>
          </>
        ) : instance.qr ? (
          <>
            {/* A base64 data URI from the API, not an optimizable asset. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={instance.qr} alt="QR code para conectar" className="h-48 w-48" />
            <p className="m-0 text-xs text-muted">No celular: WhatsApp › Dispositivos conectados › Conectar dispositivo.</p>
          </>
        ) : (
          <p className="m-0 text-xs text-muted">Gerando código…</p>
        )}
        <p className="m-0 text-xs text-muted">Aguardando leitura…</p>
        <div className="flex gap-3">
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => void refresh()}>
            Gerar novo
          </button>
          <button type="button" className="text-sm text-danger underline" disabled={busy} onClick={() => void disconnect()}>
            Cancelar
          </button>
        </div>
        {alert}
      </>
    );
  } else {
    body = (
      <>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
          {RISK_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} disabled={disabled} onChange={(event) => setAccepted(event.target.checked)} className="mt-1" />
          <span>Entendo que este canal não é oficial e que meu número pode ser bloqueado pela Meta.</span>
        </label>
        {byCode ? (
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(11) 99999-9999"
            aria-label="Telefone"
            className="w-full rounded-xl border border-outline px-3 py-2 text-sm"
          />
        ) : (
          <button type="button" className="text-xs underline" onClick={() => setByCode(true)}>
            Prefiro conectar com código
          </button>
        )}
        <button
          type="button"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
          disabled={!accepted || disabled || busy || (byCode && !phone)}
          onClick={() => void connect()}
        >
          Conectar
        </button>
        {alert}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}
    </div>
  );
}

export function maskPhone(phone: string | null): string {
  if (!phone) {
    return "seu número";
  }

  return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} 9····-${phone.slice(-4)}`;
}

function ReceivyCardBody({ settings }: { settings: WhatsappSettings | null }) {
  return (
    <>
      {settings?.quota ? (
        <>
          <p className="m-0 text-sm text-ink">{`${settings.quota.used} de ${settings.quota.limit} mensagens neste ciclo`}</p>
          <QuotaBar used={settings.quota.used} limit={settings.quota.limit} />
          <p className="m-0 text-xs text-muted">{settings.quota.cycleEnd ? `Renova em ${chargeDateText(settings.quota.cycleEnd.slice(0, 10))}` : "Renova todo mês"}</p>
        </>
      ) : null}
      <p className="m-0 text-xs text-muted">Número oficial, mensagens com modelos aprovados pela Meta. Seus contatos precisam ter aceitado receber.</p>
    </>
  );
}

type PlainCardProps = { title: string; disabled: boolean; lockedTag: string | null; children: ReactNode };

/** Only one sender option is enabled: no radiogroup, just the card body (spec: no radio header/indicator). */
function PlainCard({ title, disabled, lockedTag, children }: PlainCardProps) {
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border border-outline p-4 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3">
        <p className="m-0 font-semibold text-ink">{title}</p>
        {lockedTag ? <LockedTag>{lockedTag}</LockedTag> : null}
      </div>
      {children}
    </div>
  );
}

const CARD_ORDER = [WhatsappSender.Receivy, WhatsappSender.Own] as const;

export function WhatsappScreen({ client = whatsappClient }: Props) {
  const [settings, setSettings] = useState<WhatsappSettings | null>(null);
  const [plan, setPlan] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const receivyCardRef = useRef<HTMLDivElement>(null);
  const ownCardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    return Promise.all([client.settings(), loadPlan()])
      .then(([loaded, tier]) => {
        setSettings(loaded);
        setPlan(tier);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o WhatsApp.");
      });
  }, [client]);

  useEffect(() => {
    if (!whatsappEnabled()) {
      return;
    }

    void load();
  }, [load]);

  if (!whatsappEnabled()) {
    return null;
  }

  const receivyOn = receivyEnabled();
  const evolutionOn = evolutionEnabled();
  const both = receivyOn && evolutionOn;

  const free = plan === PlanTier.Free;
  const locked = free || busy || !settings;
  const senderValue = settings?.sender ?? WhatsappSender.Receivy;

  // A flag can be on while the API capability behind it is off; that card renders disabled with "Em breve".
  const receivyCapabilityLocked = settings ? !settings.available : false;
  const ownCapabilityLocked = settings ? !settings.ownAvailable : false;

  function cardRefFor(sender: WhatsappSender): RefObject<HTMLDivElement | null> {
    return sender === WhatsappSender.Receivy ? receivyCardRef : ownCardRef;
  }

  // Roving tabindex: only the checked card is tabbable; both fall out of the tab order together when locked
  // (both cards always share the same `locked` state here, so "checked" and "first enabled" coincide).
  function tabIndexFor(sender: WhatsappSender): number {
    if (locked) {
      return -1;
    }

    return sender === senderValue ? 0 : -1;
  }

  async function select(sender: WhatsappSender) {
    if (!settings || sender === settings.sender) {
      return;
    }

    // Picking the own number without a pairing opens the connect flow instead (Task 5); the API switches on its own once it opens.
    if (sender === WhatsappSender.Own && !settings.instance) {
      return;
    }

    // A capability-locked card ("Em breve") never switches, even from an arrow-key press.
    if (sender === WhatsappSender.Receivy && receivyCapabilityLocked) {
      return;
    }

    if (sender === WhatsappSender.Own && ownCapabilityLocked) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const next = await client.setSender(sender);

      setSettings({ ...settings, sender: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não deu para trocar o remetente.");
    } finally {
      setBusy(false);
    }
  }

  function moveSelection(current: WhatsappSender, direction: 1 | -1) {
    const index = CARD_ORDER.indexOf(current);
    const next = CARD_ORDER[(index + direction + CARD_ORDER.length) % CARD_ORDER.length]!;

    cardRefFor(next).current?.focus();

    // Same guard a click gets from `SenderCard`'s own `disabled` check: no PATCH on the Free plan,
    // and no second PATCH while one from a previous click or arrow press is still in flight.
    if (locked) {
      return;
    }

    void select(next);
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      {error ? (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {free ? (
        <div className="rounded-2xl border border-outline p-4">
          <p className="m-0 text-sm text-muted">Lembretes por WhatsApp fazem parte do plano Básico.</p>
          <Link href="/settings/plan" className="mt-3 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary">
            Assinar o Básico
          </Link>
        </div>
      ) : null}

      {both ? (
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Enviar por">
          <SenderCard
            value={WhatsappSender.Receivy}
            selected={senderValue}
            disabled={locked || receivyCapabilityLocked}
            lockedTag={receivyCapabilityLocked ? "Em breve" : null}
            title="Número do Receivy"
            tabIndex={tabIndexFor(WhatsappSender.Receivy)}
            cardRef={receivyCardRef}
            onSelect={(sender) => void select(sender)}
            onArrow={(direction) => moveSelection(WhatsappSender.Receivy, direction)}
          >
            {receivyCapabilityLocked ? null : <ReceivyCardBody settings={settings} />}
          </SenderCard>

          <SenderCard
            value={WhatsappSender.Own}
            selected={senderValue}
            disabled={locked || ownCapabilityLocked}
            lockedTag={ownCapabilityLocked ? "Em breve" : null}
            title="Meu número"
            tabIndex={tabIndexFor(WhatsappSender.Own)}
            cardRef={ownCardRef}
            onSelect={(sender) => void select(sender)}
            onArrow={(direction) => moveSelection(WhatsappSender.Own, direction)}
          >
            {ownCapabilityLocked ? null : <OwnNumberCard settings={settings} client={client} disabled={locked} onChange={setSettings} />}
          </SenderCard>
        </div>
      ) : receivyOn ? (
        <PlainCard title="Número do Receivy" disabled={locked || receivyCapabilityLocked} lockedTag={receivyCapabilityLocked ? "Em breve" : null}>
          {receivyCapabilityLocked ? null : <ReceivyCardBody settings={settings} />}
        </PlainCard>
      ) : evolutionOn ? (
        <PlainCard title="Meu número" disabled={locked || ownCapabilityLocked} lockedTag={ownCapabilityLocked ? "Em breve" : null}>
          {!ownCapabilityLocked && settings?.instance && settings.sender !== WhatsappSender.Own ? (
            <button
              type="button"
              className="self-start rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary"
              disabled={locked}
              onClick={() => void select(WhatsappSender.Own)}
            >
              Usar este número
            </button>
          ) : null}
          {ownCapabilityLocked ? null : <OwnNumberCard settings={settings} client={client} disabled={locked} onChange={setSettings} />}
        </PlainCard>
      ) : null}
    </div>
  );
}
