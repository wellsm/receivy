import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import {
  type BadgeTone,
  DEFAULT_FEED_FILTERS,
  activeFeedFilterCount,
  calendarDate,
  chargeAction,
  chargeBadges,
  chargeStateLabel,
  type ChargeSummary,
  type Direction,
  feedDayLabel,
  feedFilterQuery,
  formatMoney,
  type FeedFilters,
  type TimelineItem,
  type TimelinePage,
} from "@receivy/common";
import { FeedFiltersSheet } from "@/components/app/feed-filters-sheet";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { useTabHeader } from "@/navigation/tab-header";
import { financialClient, type FinancialClient } from "@/financial/client";
import { notificationClient } from "@/notifications/client";
import { ACTIVE_TINT } from "@/theme/colors";

type FeedScreenProps = {
  client?: Pick<FinancialClient, "timeline">;
  notifications?: Pick<typeof notificationClient, "remind">;
  onOpenCharge?: (id: string) => void;
};


const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-800",
  warning: "bg-amber-50 text-amber-900",
  success: "bg-primary-soft/50 text-primary-strong",
  neutral: "bg-surface-muted text-muted",
};


function itemDate(item: TimelineItem): string {
  if (item.kind === "charge") {
    return item.charge.dueDate;
  }

  if (item.kind === "billing_preview") {
    return item.preview.occurrenceDate;
  }

  if (item.kind === "proof") {
    return item.proof.sentAt.slice(0, 10);
  }

  return item.payment.paidAt.slice(0, 10);
}

function groupByDay(items: TimelineItem[]): [string, TimelineItem[]][] {
  const groups = new Map<string, TimelineItem[]>();

  for (const item of items) {
    const date = itemDate(item);
    groups.set(date, [...(groups.get(date) ?? []), item]);
  }

  return [...groups];
}

function pluralize(count: number): string {
  return count === 1 ? "1 pendência" : `${count} pendências`;
}

function TotalCard({ label, amount, count, tone }: { label: string; amount: string; count: number; tone: "receivable" | "payable" }) {
  const receivable = tone === "receivable";

  return (
    <View className="flex-1 overflow-hidden rounded-2xl border border-outline/40 bg-surface p-4">
      <View className={`absolute left-0 right-0 top-0 h-1 ${receivable ? "bg-primary" : "bg-red-600"}`} />
      <View className="flex-row items-center justify-between">
        <Text className="text-[11px] font-bold tracking-widest text-muted">{label}</Text>
        <Text className={`text-base font-extrabold ${receivable ? "text-primary" : "text-red-600"}`}>{receivable ? "↙" : "↗"}</Text>
      </View>
      <Text className={`mt-2 text-xl font-extrabold tracking-tight ${receivable ? "text-primary" : "text-red-700"}`}>{amount}</Text>
      <View className="mt-3 flex-row items-center gap-1.5 border-t border-outline/30 pt-2">
        <View className={`h-1.5 w-1.5 rounded-full ${receivable ? "bg-primary" : "bg-red-600"}`} />
        <Text className="text-[11px] font-semibold text-muted">{pluralize(count)}</Text>
      </View>
    </View>
  );
}

function ChargeCard({
  charge,
  direction,
  today,
  onOpen,
  onRemind,
  reminded,
}: {
  charge: ChargeSummary;
  direction: Direction;
  today: string;
  onOpen: () => void;
  onRemind: () => void;
  reminded: string | null;
}) {
  const badges = chargeBadges(charge, today);
  const action = chargeAction(charge, direction);
  const settled = charge.state !== "pending";
  const amountClass = settled ? "text-muted" : direction === "receivable" ? "text-primary" : "text-red-700";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir cobrança ${charge.description}`}
      onPress={onOpen}
      className="gap-3 rounded-2xl border border-outline/40 bg-surface p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft/50">
          <Text className="text-base font-extrabold text-primary-strong">{charge.counterpartName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-sm text-muted" numberOfLines={1}>
            <Text className="font-bold text-ink">{charge.counterpartName}</Text> · {charge.description}
          </Text>
          {badges.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">
              {badges.map((badge) => (
                <Text key={badge.label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[badge.tone]}`}>
                  {badge.label}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
      <View className="flex-row items-center justify-between border-t border-outline/30 pt-3">
        <View>
          <Text className={`text-lg font-extrabold tracking-tight ${amountClass}`}>{formatMoney(charge.amount)}</Text>
          <Text className="text-[11px] text-muted">{chargeStateLabel(charge, direction)}</Text>
        </View>
        {action && action.kind === "remind" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reminded ?? action.label}
            disabled={reminded !== null}
            onPress={onRemind}
            className="min-h-10 justify-center rounded-lg bg-primary-soft/40 px-3"
          >
            <Text className="text-xs font-bold text-primary-strong">{reminded ?? action.label}</Text>
          </Pressable>
        )}
        {action && action.kind === "open" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={onOpen}
            className={`min-h-10 justify-center rounded-lg px-3 ${action.label === "Pagar via Pix" ? "bg-primary" : "bg-surface-muted"}`}
          >
            <Text className={`text-xs font-bold ${action.label === "Pagar via Pix" ? "text-white" : "text-primary-strong"}`}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export function FeedScreen({
  client = financialClient,
  notifications = notificationClient,
  onOpenCharge,
}: FeedScreenProps) {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Read by `load` so the focus callback stays stable across filter changes and never double-fetches.
  const filtersRef = useRef<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    async (nextFilters = filtersRef.current, cursor?: string, quiet = false) => {
      const requestGeneration = cursor ? generation.current : ++generation.current;

      setError("");

      // A quiet load keeps the current items on screen while fresh ones arrive (focus and pull to refresh).
      if (!quiet) {
        setLoading(true);
      }

      if (!cursor && !quiet) {
        setData(null);
      }

      const params = feedFilterQuery(nextFilters);

      if (cursor) {
        params.set("cursor", cursor);
      }

      try {
        const page = await client.timeline(params.toString());

        if (requestGeneration !== generation.current) {
          return;
        }

        setData((previous) => (cursor && previous ? { ...page, items: [...previous.items, ...page.items] } : page));
      } catch (reason) {
        if (requestGeneration === generation.current) {
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar seu feed.");
        }
      } finally {
        if (requestGeneration === generation.current) {
          setLoading(false);
        }
      }
    },
    [client],
  );

  // The charge routes sit on top of the tabs: paid or cancelled items must be current when the feed comes back.
  useFocusEffect(
    useCallback(() => {
      void load(undefined, undefined, true);
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(undefined, undefined, true);
    setRefreshing(false);
  }, [load]);

  function confirmRemind(charge: ChargeSummary) {
    Alert.alert(
      "Enviar lembrete?",
      `Avisa ${charge.counterpartName} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`,
      [
        { text: "Voltar", style: "cancel" },
        { text: "Enviar lembrete", onPress: () => void remind(charge.id) },
      ],
    );
  }

  async function remind(chargeId: string) {
    try {
      await notifications.remind(chargeId);
      setReminded((current) => ({ ...current, [chargeId]: "Lembrete enviado" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o lembrete.");
    }
  }

  const summary = data?.summary;
  const changedFilters = activeFeedFilterCount(filters);

  useTabHeader({ title: "Feed" });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView
        testID="feed-list"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={ACTIVE_TINT} />}
      >
        <View className="gap-5 px-5 pt-2">
          <View className="flex-row gap-3">
            <TotalCard label="A RECEBER" amount={summary ? formatMoney(summary.receivable) : "—"} count={summary?.receivableCount ?? 0} tone="receivable" />
            <TotalCard label="A PAGAR" amount={summary ? formatMoney(summary.payable) : "—"} count={summary?.payableCount ?? 0} tone="payable" />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filtros"
            onPress={() => setFiltersOpen(true)}
            className={`min-h-11 flex-row items-center justify-center gap-2 rounded-full border px-4 ${changedFilters ? "border-primary bg-primary-soft/50" : "border-outline bg-surface"}`}
          >
            <Text className={`text-sm font-bold ${changedFilters ? "text-primary-strong" : "text-ink"}`}>Filtros</Text>
            {changedFilters > 0 && (
              <Text className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{changedFilters}</Text>
            )}
          </Pressable>

          {loading && <ActivityIndicator accessibilityLabel="Carregando feed" className="my-6" color="#0B513D" />}
          {error ? (
            <View className="gap-2 rounded-xl bg-red-50 p-4">
              <Text accessibilityRole="alert" className="text-red-700">
                {error}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} className="min-h-12 justify-center">
                <Text className="font-bold text-red-700">Tentar novamente</Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && !error && data?.items.length === 0 && (
            <View className="gap-2 rounded-2xl border border-outline/40 bg-surface p-5">
              <Text className="text-2xl font-extrabold text-primary-strong">Sua timeline começa aqui</Text>
              <Text className="text-sm leading-6 text-muted">Crie uma conta na aba Contas ou entre com o e-mail em que recebeu uma.</Text>
            </View>
          )}

          {groupByDay(data?.items ?? []).map(([date, items]) => (
            <View key={date} className="gap-3">
              <View className="flex-row items-center gap-2 px-1">
                <View className={`h-2 w-2 rounded-full ${date === today ? "bg-primary" : "bg-outline"}`} />
                <Text className={`text-sm font-bold tracking-wide ${date === today ? "text-primary" : "text-muted"}`}>{feedDayLabel(date, today)}</Text>
              </View>
              {items.map((item, index) => {
                if (item.kind === "charge") {
                  return (
                    <ChargeCard
                      key={item.charge.id}
                      charge={item.charge}
                      direction={item.direction}
                      today={today}
                      reminded={reminded[item.charge.id] ?? null}
                      onOpen={() => onOpenCharge?.(item.charge.id)}
                      onRemind={() => confirmRemind(item.charge)}
                    />
                  );
                }

                if (item.kind === "billing_preview") {
                  return (
                    <View key={`${item.kind}-${index}`} className="gap-1 rounded-2xl border border-dashed border-outline bg-surface p-4">
                      <Text className="text-sm font-bold text-ink">{item.preview.description}</Text>
                      <Text className="text-xs text-muted">Previsto · {formatMoney(item.preview.amount)} · ainda não é cobrança</Text>
                    </View>
                  );
                }

                return (
                  <View key={`${item.kind}-${item.kind === "payment" ? item.payment.chargeId : item.proof.chargeId}`} className="rounded-2xl bg-surface-muted px-4 py-3">
                    <Text className="text-xs font-semibold text-muted">
                      {item.kind === "payment" ? `Pagamento registrado · ${formatMoney(item.payment.amount)}` : "Comprovante enviado"}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}

          {data?.nextCursor && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Carregar mais"
              disabled={loading}
              onPress={() => void load(filters, data.nextCursor ?? undefined)}
              className="min-h-12 items-center justify-center rounded-xl border border-outline"
            >
              <Text className="font-bold text-primary">Carregar mais</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {filtersOpen && (
        <FeedFiltersSheet
          value={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFiltersOpen(false);
            setFilters(next);
            filtersRef.current = next;
            void load(next);
          }}
        />
      )}
    </SafeAreaView>
  );
}
