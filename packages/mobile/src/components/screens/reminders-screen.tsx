import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import {
  calendarDate,
  PlanTier,
  type ChannelSet,
  type ReminderConfig,
  type ReminderDraft,
  type ReminderSettings,
  validateReminderConfig,
} from "@receivy/common";
import { accountClient, type AccountClient } from "@/account/client";
import { financialClient, type FinancialClient } from "@/financial/client";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { ManualChannels, ReminderEditor, ReminderPreview } from "@/components/app/reminder-editor";

type Client = Pick<AccountClient, "reminders" | "saveReminders" | "clearReminders">;
type Plans = Pick<FinancialClient, "plan">;

type RemindersScreenProps = {
  client?: Client;
  plans?: Plans;
};

const LOAD_ERROR = "Não foi possível carregar seus lembretes.";
const ACTION_ERROR = "Não foi possível salvar seus lembretes.";

function toDrafts(config: ReminderConfig): ReminderDraft[] {
  return config.reminders.map((rule) => ({ ...rule, offsetDays: String(rule.offsetDays) }));
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 font-sans text-[11px] font-semibold tracking-[0.88px] text-muted">{title}</Text>
      <View className="gap-3 rounded-[20px] border border-outline bg-surface p-4">{children}</View>
    </View>
  );
}

export function RemindersScreen({ client = accountClient, plans = financialClient }: RemindersScreenProps) {
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
    return Promise.all([client.reminders(), plans.plan()])
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
  }, [applySettings, client, plans]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError("");

    let config: ReminderConfig;

    try {
      config = validateReminderConfig({
        reminders: rules.map((rule) => ({ ...rule, offsetDays: Number(rule.offsetDays) })),
        manual,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);

      return;
    }

    setBusy(true);

    try {
      applySettings(await client.saveReminders(config));
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
      applySettings(await client.clearReminders());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
        <Text className="p-4 font-sans text-sm text-muted">{error || "Carregando…"}</Text>
      </SafeAreaView>
    );
  }

  const whatsapp = { available: whatsappAvailable, planAllows: plan === PlanTier.Basic };

  // The settings screen has no charge: the preview dates the rules against today.
  const example = calendarDate();

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <View className="flex-1 gap-4 px-5 pt-4">
        <Section title="LEMBRETES AUTOMÁTICOS">
          <ReminderEditor rules={rules} onChange={setRules} whatsapp={whatsapp} disabled={busy} />
          <ReminderPreview rules={rules} dueDate={example} />
        </Section>

        <Section title="LEMBRETE MANUAL">
          <ManualChannels value={manual} onChange={setManual} whatsapp={whatsapp} disabled={busy} />
        </Section>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 font-sans text-sm text-danger">
            {error}
          </Text>
        ) : null}

        <View className="flex-row gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Salvar"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void save()}
            className="h-11 flex-1 items-center justify-center rounded-xl bg-primary"
          >
            <Text className="font-sans text-sm font-bold text-on-primary">Salvar</Text>
          </Pressable>

          {!inherited ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voltar ao padrão"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void reset()}
              className="h-11 flex-1 items-center justify-center rounded-xl border border-outline"
            >
              <Text className="font-sans text-sm font-semibold text-ink">Voltar ao padrão</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}
