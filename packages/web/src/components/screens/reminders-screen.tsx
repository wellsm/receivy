"use client";

import {
  calendarDate,
  PlanTier,
  type ChannelSet,
  type PlanSummary,
  type ReminderConfig,
  type ReminderDraft,
  type ReminderSettings,
  validateReminderConfig,
} from "@receivy/common";
import { useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { ManualChannels, ReminderEditor, ReminderPreview } from "@/components/app/reminder-editor";

const LOAD_ERROR = "Não foi possível carregar seus lembretes.";
const ACTION_ERROR = "Não foi possível salvar seus lembretes.";

async function request<T>(
  path: string,
  init?: RequestInit,
  fallback = ACTION_ERROR,
): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

function toDrafts(config: ReminderConfig): ReminderDraft[] {
  return config.reminders.map(rule => ({ ...rule, offsetDays: String(rule.offsetDays) }));
}

export function RemindersScreen() {
  const [rules, setRules] = useState<ReminderDraft[]>([]);
  const [manual, setManual] = useState<ChannelSet>({ email: true, whatsapp: true });
  const [inherited, setInherited] = useState(true);
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [plan, setPlan] = useState<PlanTier>(PlanTier.Free);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const applySettings = useCallback((settings: ReminderSettings) => {
    setRules(toDrafts(settings.config));
    setManual(settings.config.manual);
    setInherited(settings.inherited);
    setWhatsappAvailable(settings.whatsappAvailable);
  }, []);

  const load = useCallback(() => {
    return Promise.all([
      request<ReminderSettings>("/api/financial/account/reminders", undefined, LOAD_ERROR),
      request<PlanSummary>("/api/financial/plan", undefined, LOAD_ERROR),
    ])
      .then(([settings, summary]) => {
        applySettings(settings);
        setPlan(summary.plan);
        setError("");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : LOAD_ERROR);
      })
      .finally(() => {
        setLoaded(true);
      });
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError("");

    let config: ReminderConfig;

    try {
      config = validateReminderConfig({
        reminders: rules.map(rule => ({ ...rule, offsetDays: Number(rule.offsetDays) })),
        manual,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);

      return;
    }

    setBusy(true);

    try {
      const settings = await request<ReminderSettings>("/api/financial/account/reminders", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });

      applySettings(settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError("");
    setBusy(true);

    try {
      const settings = await request<ReminderSettings>("/api/financial/account/reminders", { method: "DELETE" });

      applySettings(settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <p className="p-4 text-sm text-muted">{error || "Carregando…"}</p>;
  }

  const whatsapp = { available: whatsappAvailable, planAllows: plan === PlanTier.Basic };

  // The settings screen has no charge: the preview dates the rules against today.
  const example = calendarDate();

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="m-0 font-display text-lg font-bold text-ink">Lembretes</h1>

      <section className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-5">
        <h2 className="m-0 text-sm font-bold text-ink">Lembretes automáticos</h2>
        <ReminderEditor rules={rules} onChange={setRules} whatsapp={whatsapp} disabled={busy} />
        <ReminderPreview rules={rules} dueDate={example} />
      </section>

      <section className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-5">
        <h2 className="m-0 text-sm font-bold text-ink">Lembrete manual</h2>
        <ManualChannels value={manual} onChange={setManual} whatsapp={whatsapp} disabled={busy} />
      </section>

      {error ? (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60"
          disabled={busy}
          onClick={() => void save()}
        >
          Salvar
        </button>

        {!inherited ? (
          <button
            type="button"
            className="h-11 flex-1 rounded-xl border border-outline text-sm font-semibold text-ink disabled:opacity-60"
            disabled={busy}
            onClick={() => void reset()}
          >
            Voltar ao padrão
          </button>
        ) : null}
      </div>
    </div>
  );
}
