"use client";

import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappSettings, chargeDateText } from "@receivy/common";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { type WhatsappClient, whatsappClient } from "@/lib/whatsapp-client";
import { whatsappEnabled } from "@/lib/whatsapp-flag";

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
  title: string;
  onSelect: (sender: WhatsappSender) => void;
  children: ReactNode;
};

/** A div, not a `<label>`: Task 5 nests a checkbox (also a label) inside the own-number card. */
function SenderCard({ value, selected, disabled, title, onSelect, children }: SenderCardProps) {
  const active = value === selected;

  function select() {
    if (disabled) {
      return;
    }

    onSelect(value);
  }

  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      aria-label={title}
      tabIndex={disabled ? -1 : 0}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        select();
      }}
      className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${active ? "border-primary" : "border-outline"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <div className="flex flex-1 flex-col gap-2">
        <p className="m-0 font-semibold text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** Task 5 fills the pairing state machine; this task only shows the connected line so the sender switch is testable. */
function OwnNumberCard({ settings }: { settings: WhatsappSettings | null }) {
  const instance = settings?.instance ?? null;

  if (instance?.state === WhatsappInstanceState.Open) {
    return <p className="m-0 text-sm text-ink">{`Conectado ao ${maskPhone(instance.phone)}`}</p>;
  }

  return <p className="m-0 text-xs text-muted">Envie pelo seu próprio WhatsApp, sem cota.</p>;
}

export function maskPhone(phone: string | null): string {
  if (!phone) {
    return "seu número";
  }

  return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} 9····-${phone.slice(-4)}`;
}

export function WhatsappScreen({ client = whatsappClient }: Props) {
  const [settings, setSettings] = useState<WhatsappSettings | null>(null);
  const [plan, setPlan] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const free = plan === PlanTier.Free;
  const locked = free || busy || !settings;

  async function select(sender: WhatsappSender) {
    if (!settings || sender === settings.sender) {
      return;
    }

    // Picking the own number without a pairing opens the connect flow instead (Task 5); the API switches on its own once it opens.
    if (sender === WhatsappSender.Own && !settings.instance) {
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

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
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

      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Enviar por">
        <SenderCard value={WhatsappSender.Receivy} selected={settings?.sender ?? WhatsappSender.Receivy} disabled={locked} title="Número do Receivy" onSelect={(sender) => void select(sender)}>
          {settings?.quota ? (
            <>
              <p className="m-0 text-sm text-ink">{`${settings.quota.used} de ${settings.quota.limit} mensagens neste ciclo`}</p>
              <QuotaBar used={settings.quota.used} limit={settings.quota.limit} />
              <p className="m-0 text-xs text-muted">
                {settings.quota.cycleEnd ? `Renova em ${chargeDateText(settings.quota.cycleEnd.slice(0, 10))}` : "Renova todo mês"}
              </p>
            </>
          ) : null}
          <p className="m-0 text-xs text-muted">Número oficial, mensagens com modelos aprovados pela Meta. Seus contatos precisam ter aceitado receber.</p>
        </SenderCard>

        <SenderCard value={WhatsappSender.Own} selected={settings?.sender ?? WhatsappSender.Receivy} disabled={locked} title="Meu número" onSelect={(sender) => void select(sender)}>
          <OwnNumberCard settings={settings} />
        </SenderCard>
      </div>
    </div>
  );
}
