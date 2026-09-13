import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, Text, TextInput, View } from "react-native";
import { BillingState, type BillingSummary, type BillingsPage, Direction, billingShareAction, calendarDate } from "@receivy/common";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { useTabHeader } from "@/navigation/tab-header";
import { financialClient, type FinancialClient } from "@/financial/client";
import { BillingCard } from "@/components/ui/billing-card";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

type Client = Pick<
  FinancialClient,
  | "billings"
  | "billing"
  | "patchBilling"
  | "paymentMethods"
  | "profile"
  | "createBilling"
  | "publicLink"
  | "publicChargeUrl"
  | "invite"
  | "revokeInvite"
>;

type BillingsScreenProps = {
  client?: Client;
  onCreate?: () => void;
  onOpenBilling?: (id: string) => void;
  onOpenCharge?: (id: string) => void;
};

const LIST_ERROR = "Não foi possível carregar suas contas.";

/** Client-side state filter over the loaded pages; ended billings stay out of the way by default. */
const STATE_FILTERS: { value: BillingState; label: string; empty: string }[] = [
  { value: BillingState.Active, label: "Ativas", empty: "Nenhuma conta ativa." },
  { value: BillingState.Paused, label: "Pausadas", empty: "Nenhuma conta pausada." },
  { value: BillingState.Ended, label: "Encerradas", empty: "Nenhuma conta encerrada." },
];

/** Server-side direction filter: the API lists both sides unless asked for one. */
const DIRECTION_FILTERS: { value: Direction | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: Direction.Receivable, label: "A receber" },
  { value: Direction.Payable, label: "A pagar" },
];

const plusMark = require("../../../assets/images/auth/plus.svg");

/** No state filter for now: active, paused and ended billings all show on the list. */
function listQuery(search: string, direction: Direction | "", cursor?: string): string {
  const parts: string[] = [];

  if (search) {
    parts.push(`search=${encodeURIComponent(search)}`);
  }

  if (direction) {
    parts.push(`direction=${direction}`);
  }

  if (cursor) {
    parts.push(`cursor=${encodeURIComponent(cursor)}`);
  }

  return parts.join("&");
}

function Button({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-xl border border-primary px-4 py-3 ${primary ? "bg-primary" : "bg-surface"} ${disabled ? "opacity-40" : ""}`}
    >
      <Text className={`font-bold ${primary ? "text-white" : "text-primary"}`}>{label}</Text>
    </Pressable>
  );
}

export function BillingsScreen({ client = financialClient, onCreate, onOpenBilling, onOpenCharge }: BillingsScreenProps) {
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<BillingState>(BillingState.Active);
  const [direction, setDirection] = useState<Direction | "">("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const requests = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return client
        .billings(listQuery(search, direction, cursor))
        .then((next) => {
          if (generation !== requests.current) {
            return;
          }

          setError("");
          setPage((previous) => (cursor && previous ? { ...next, billings: [...previous.billings, ...next.billings] } : next));
        })
        .catch((reason: unknown) => {
          if (generation === requests.current) {
            setError(reason instanceof Error ? reason.message : LIST_ERROR);
          }
        });
    },
    [client, direction, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);

    return () => clearTimeout(timer);
  }, [term]);

  // The detail routes sit on top of the tabs: an ended or edited billing must be gone when the list comes back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function share(billing: BillingSummary) {
    setError("");

    const chargeId = billing.shareChargeId;

    // A conta a pagar has no public link: its card opens the detail instead.
    if (billing.direction === "payable" || billingShareAction(billing) !== "share" || !chargeId) {
      onOpenBilling?.(billing.id);
      return;
    }

    try {
      const link = await client.publicLink(chargeId);
      const url = client.publicChargeUrl(link.token);

      await Share.share({ title: "Cobrança Receivy", message: url, url });
    } catch {
      onOpenCharge?.(chargeId);
    }
  }

  useTabHeader({ title: "Contas" });

  const visible = page?.billings.filter((billing) => billing.state === stateFilter) ?? [];
  const filter = STATE_FILTERS.find((option) => option.value === stateFilter) ?? STATE_FILTERS[0]!;

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <View className="gap-3 px-5 pb-2 pt-3">
        <TextInput
          accessibilityLabel="Buscar por título ou descrição"
          placeholder="Buscar por título ou descrição…"
          placeholderTextColor={MUTED_TINT}
          value={term}
          onChangeText={setTerm}
          className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
        />
        <View accessibilityRole="radiogroup" accessibilityLabel="Estado" className="flex-row gap-2">
          {STATE_FILTERS.map((option) => {
            const selected = option.value === stateFilter;

            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: selected }}
                onPress={() => setStateFilter(option.value)}
                className={`min-h-9 items-center justify-center rounded-full border px-4 ${selected ? "border-primary bg-primary-soft/60" : "border-outline/40 bg-surface"}`}
              >
                <Text className={`text-xs font-semibold ${selected ? "text-primary-strong" : "text-muted"}`}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Direção" className="flex-row gap-2">
          {DIRECTION_FILTERS.map((option) => {
            const selected = option.value === direction;

            return (
              <Pressable
                key={option.label}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: selected }}
                onPress={() => setDirection(option.value)}
                className={`min-h-9 items-center justify-center rounded-full border px-4 ${selected ? "border-primary bg-primary-soft/60" : "border-outline/40 bg-surface"}`}
              >
                <Text className={`text-xs font-semibold ${selected ? "text-primary-strong" : "text-muted"}`}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        testID="billings-list"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={ACTIVE_TINT} />}
      >
        <View className="gap-3 px-5 pt-2">
          {!page && !error && <ActivityIndicator accessibilityLabel="Carregando contas" className="my-6" color={ACTIVE_TINT} />}

          {error ? (
            <View className="gap-2 rounded-xl bg-red-50 p-4">
              <Text accessibilityRole="alert" className="text-red-700">
                {error}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={() => void load()} className="min-h-12 justify-center">
                <Text className="font-bold text-red-700">Tentar novamente</Text>
              </Pressable>
            </View>
          ) : null}

          {page && !page.billings.length && (
            <View className="gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
              <Text className="text-2xl font-extrabold text-primary-strong">Nenhuma conta ainda</Text>
              <Text className="text-sm leading-6 text-muted">Crie a primeira para acompanhar os vencimentos.</Text>
              <Button label="Nova conta" primary onPress={() => onCreate?.()} />
            </View>
          )}

          {page && page.billings.length > 0 && !visible.length && <Text className="py-6 text-center text-sm text-muted">{filter.empty}</Text>}

          {visible.map((billing) => (
            <BillingCard
              key={billing.id}
              billing={billing}
              today={today}
              onShare={(target) => void share(target)}
              onOpen={(target) => onOpenBilling?.(target.id)}
            />
          ))}

          {page?.nextCursor && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Carregar mais"
              onPress={() => void load(page.nextCursor ?? undefined)}
              className="min-h-12 items-center justify-center rounded-xl border border-outline"
            >
              <Text className="font-bold text-primary">Carregar mais</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Sits in the flow, not absolute: the safe-area bottom edge keeps it above the tab bar on both platforms. */}
      <View className="border-t border-outline/20 bg-canvas px-5 pb-2 pt-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nova conta"
          onPress={() => onCreate?.()}
          className="h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary-strong"
        >
          <Image source={plusMark} tintColor="#FFFFFF" style={{ width: 20, height: 20 }} />
          <Text className="text-base font-bold text-white">Cadastrar Nova Conta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
