import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { chargeDateText, PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings } from "@receivy/common";
import { accountClient, type AccountClient } from "@/account/client";
import { financialClient, type FinancialClient } from "@/financial/client";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { whatsappEnabled } from "@/whatsapp-flag";

type Client = Pick<AccountClient, "whatsapp" | "whatsappInstance" | "connectWhatsapp" | "disconnectWhatsapp" | "setWhatsappSender">;
type Plans = Pick<FinancialClient, "plan">;

type WhatsappScreenProps = {
  client?: Client;
  plans?: Plans;
};

const LOAD_ERROR = "Não foi possível carregar o WhatsApp.";
const SELECT_ERROR = "Não deu para trocar o remetente.";

/** `5511988887777` → `+55 11 9····-7777`; identical to the web `maskPhone`. */
export function maskPhone(phone: string | null): string {
  if (!phone) {
    return "seu número";
  }

  return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} 9····-${phone.slice(-4)}`;
}

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;

  return (
    <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <View className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
    </View>
  );
}

/** Only the two states this task needs; the connect flow and the pending/closed states land in Task 7. */
function OwnNumberCard({ instance }: { instance: WhatsappInstanceView | null }) {
  if (instance?.state === WhatsappInstanceState.Open) {
    return <Text className="font-sans text-sm text-ink">{`Conectado ao ${maskPhone(instance.phone)}`}</Text>;
  }

  return <Text className="font-sans text-xs text-muted">Envie pelo seu próprio WhatsApp, sem cota.</Text>;
}

type RadioCardProps = {
  value: WhatsappSender;
  selected: WhatsappSender;
  disabled: boolean;
  title: string;
  onSelect: (sender: WhatsappSender) => void;
  children: ReactNode;
};

function RadioCard({ value, selected, disabled, title, onSelect, children }: RadioCardProps) {
  const checked = value === selected;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onSelect(value)}
      className={`gap-2 rounded-2xl border p-4 ${checked ? "border-primary" : "border-outline"} ${disabled ? "opacity-60" : ""}`}
    >
      <Text className="font-sans text-[14.5px] font-semibold text-ink">{title}</Text>
      {children}
    </Pressable>
  );
}

export function WhatsappScreen({ client = accountClient, plans = financialClient }: WhatsappScreenProps) {
  const [settings, setSettings] = useState<WhatsappSettings | null>(null);
  const [plan, setPlan] = useState<PlanTier | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([client.whatsapp(), plans.plan()])
      .then(([loaded, summary]) => {
        setSettings(loaded);
        setPlan(summary.plan);
        setError("");
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : LOAD_ERROR);
      });
  }, [client, plans]);

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
  const senderValue = settings?.sender ?? WhatsappSender.Receivy;

  async function select(sender: WhatsappSender) {
    if (!settings || locked || sender === settings.sender) {
      return;
    }

    // Picking the own number without a pairing opens the connect flow instead (Task 7); the API
    // switches the sender on its own once it opens.
    if (sender === WhatsappSender.Own && !settings.instance) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const next = await client.setWhatsappSender(sender);

      setSettings({ ...settings, sender: next });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SELECT_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View className="gap-4 px-5 pt-4">
          {error ? (
            <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 font-sans text-sm text-danger">
              {error}
            </Text>
          ) : null}

          {free ? (
            <View className="rounded-2xl border border-outline p-4">
              <Text className="font-sans text-sm text-muted">Lembretes por WhatsApp fazem parte do plano Básico.</Text>
              <Text className="mt-2 font-sans text-xs text-muted">Gerencie seu plano no site.</Text>
            </View>
          ) : null}

          <View accessibilityRole="radiogroup" accessibilityLabel="Enviar por" className="gap-3">
            <RadioCard value={WhatsappSender.Receivy} selected={senderValue} disabled={locked} title="Número do Receivy" onSelect={(sender) => void select(sender)}>
              {settings?.quota ? (
                <>
                  <Text className="font-sans text-sm text-ink">{`${settings.quota.used} de ${settings.quota.limit} mensagens neste ciclo`}</Text>
                  <QuotaBar used={settings.quota.used} limit={settings.quota.limit} />
                  <Text className="font-sans text-xs text-muted">
                    {settings.quota.cycleEnd ? `Renova em ${chargeDateText(settings.quota.cycleEnd.slice(0, 10))}` : "Renova todo mês"}
                  </Text>
                </>
              ) : null}
              <Text className="font-sans text-xs text-muted">Número oficial, mensagens com modelos aprovados pela Meta. Seus contatos precisam ter aceitado receber.</Text>
            </RadioCard>

            <RadioCard value={WhatsappSender.Own} selected={senderValue} disabled={locked} title="Meu número" onSelect={(sender) => void select(sender)}>
              <OwnNumberCard instance={settings?.instance ?? null} />
            </RadioCard>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
