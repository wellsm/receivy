import { billingCategoryLabel, formatMoney, type BillingDetail } from "@receivy/common";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { ACTIVE_TINT } from "./tab-bar";

type Client = Pick<FinancialClient, "billing" | "publicLink" | "publicChargeUrl" | "invite">;

type BillingCreatedScreenProps = {
  client?: Client;
  id: string;
  onOpenCharge: (chargeId: string) => void;
  onBack: () => void;
};

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

function Action({ label, primary = false, disabled, onPress }: { label: string; primary?: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-14 items-center justify-center rounded-2xl border border-primary ${primary ? "bg-primary" : "bg-surface"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`font-bold ${primary ? "text-white" : "text-primary"}`}>{label}</Text>
    </Pressable>
  );
}

/** Short success screen: the billing is already saved, this is only about sharing it. */
export function BillingCreatedScreen({ client = financialClient, id, onOpenCharge, onBack }: BillingCreatedScreenProps) {
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;

    void client
      .billing(id)
      .then((detail) => {
        if (live) {
          setBilling(detail);
        }
      })
      .catch((reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [client, id]);

  const people = billing?.split.parts.filter((part) => part.kind === "person").length ?? 0;
  const pending = billing?.charges.find((charge) => charge.state === "pending");
  const first = billing?.charges[0];

  async function shareLink() {
    if (!pending) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const link = await client.publicLink(pending.id);
      const url = client.publicChargeUrl(link.token);

      await Share.share({ title: "Cobrança Receivy", message: url, url });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o link público.");
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!billing) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const created = await client.invite(billing.id);

      await Share.share({ title: "Convite Receivy", message: `Entre na cobrança ${billing.description} no Receivy: ${created.url}` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-12 pt-6" showsVerticalScrollIndicator={false}>
        {!billing && !error && <ActivityIndicator accessibilityLabel="Carregando cobrança" color={ACTIVE_TINT} />}

        {billing && (
          <>
            <Text className="text-xs font-bold uppercase tracking-widest text-primary">{billingCategoryLabel(billing.category)}</Text>
            <Text accessibilityRole="header" className="text-3xl font-extrabold text-primary-strong">
              Cobrança criada
            </Text>
            <Text className="text-lg font-semibold text-ink">
              {billing.description} · {formatMoney(billing.total)}
            </Text>
          </>
        )}

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
            {error}
          </Text>
        ) : null}

        <View className="gap-3">
          {people === 1 && pending && <Action label="Compartilhar link" primary disabled={busy} onPress={() => void shareLink()} />}
          {billing && <Action label="Convidar" disabled={busy} onPress={() => void invite()} />}
          {first && <Action label="Ver cobrança" disabled={busy} onPress={() => onOpenCharge(first.id)} />}
          <Action label="Voltar às cobranças" disabled={busy} onPress={onBack} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
