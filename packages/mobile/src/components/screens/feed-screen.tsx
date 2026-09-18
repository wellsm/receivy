import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import {
  type BadgeTone,
  ChargeActionKind,
  ChargeState,
  type ChargeTotals,
  currentMonth,
  DEFAULT_FEED_FILTERS,
  Direction,
  activeFeedFilterCount,
  calendarDate,
  chargeAction,
  chargeBadges,
  chargeStateLabel,
  chargeSummaryOf,
  chargeTotals,
  type ChargeSummary,
  feedDayLabel,
  filterCharges,
  formatMoney,
  type FeedFilters,
  groupChargesByDay,
  type ListCharge,
  type ListChargeItem,
  monthTabs,
  openChargesTotal,
} from "@receivy/common";
import { FeedFiltersSheet } from "@/components/app/feed-filters-sheet";
import { RemindSheet } from "@/components/app/remind-sheet";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { useTabHeader } from "@/navigation/tab-header";
import { financialClient, type FinancialClient } from "@/financial/client";
import { notificationClient } from "@/notifications/client";
import { useThemeColors } from "@/theme/colors";

type FeedScreenProps = {
  client?: Pick<FinancialClient, "charges"> & Partial<Pick<FinancialClient, "pay" | "declarePayment">>;
  notifications?: Pick<typeof notificationClient, "remind">;
  onOpenCharge?: (id: string) => void;
};

const slidersMark = require("../../../assets/images/auth/sliders.svg");

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** In the dense row a badge is only tinted text beside the state label. */
const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "text-payable",
  info: "text-primary",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-muted",
};

/** `2026-09-14` → `14 set`, appended to the relative day names on the day bar. */
function shortDay(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

/** The day bar and the totals already say it is money: rows show only the figure. */
function withoutCurrency(text: string): string {
  return text.replace(/^R\$\s*/, "");
}

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** `+ R$ 1.620,10` / `− R$ 40,00`: the Previsto and Realizado figures carry their own sign. */
function signedMoney(amountCents: number): string {
  const sign = amountCents > 0 ? "+ " : amountCents < 0 ? "− " : "";

  return `${sign}${formatMoney({ amountCents: Math.abs(amountCents), currency: "BRL" })}`;
}

/** Design 3b: previous, selected and next month; the carousel re-centers on whichever one is tapped. */
function MonthTabsBar({ month, onSelect }: { month: string; onSelect: (value: string) => void }) {
  const tabs = monthTabs(month);

  return (
    <View className="mx-[18px] flex-row border-b border-outline">
      {tabs.map((tab) => (
        <Pressable
          key={tab.value}
          accessibilityRole="tab"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: tab.selected }}
          onPress={() => onSelect(tab.value)}
          className={`flex-1 items-center pb-[9px] pt-[7px] ${tab.selected ? "border-b-[2.5px] border-primary" : ""}`}
        >
          <Text className={`font-sans ${tab.selected ? "text-[13.5px] font-extrabold text-ink" : "text-xs font-bold text-muted"}`}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Design 1b: both open totals with what was already settled this month, a bar split by their weight,
 * and the month's Previsto (everything due, open or settled) beside its Realizado (only what was settled).
 */
function SummaryBox({ summary }: { summary?: ChargeTotals }) {
  const receivable = summary?.receivable.pending.amountCents ?? 0;
  const payable = summary?.payable.pending.amountCents ?? 0;
  const received = summary?.receivable.paid.amountCents ?? 0;
  const paid = summary?.payable.paid.amountCents ?? 0;
  const realized = received - paid;

  return (
    <View className="mx-4.5 overflow-hidden rounded-[18px] border border-outline bg-surface">
      <View className="flex-row">
        <View className="flex-1 border-r border-outline px-3.5 py-2.75">
          <View className="flex-row items-baseline justify-between gap-1.5">
            <Text className="font-sans text-[10.5px] font-bold tracking-[1px] text-muted">A RECEBER</Text>
          </View>
          <Text className="mt-1 font-display text-[20px] font-bold text-primary" style={TABULAR}>
            {summary ? formatMoney(summary.receivable.pending) : "—"}
          </Text>
        </View>

        <View className="flex-1 px-3.5 py-2.75">
          <View className="flex-row items-baseline justify-between gap-1.5">
            <Text className="font-sans text-[10.5px] font-bold tracking-[1px] text-muted">A PAGAR</Text>
          </View>
          <Text className="mt-1 font-display text-[20px] font-bold text-payable" style={TABULAR}>
            {summary ? formatMoney(summary.payable.pending) : "—"}
          </Text>
        </View>
      </View>

      {receivable + payable > 0 ? (
        <View className="h-1.25 flex-row">
          <View className="bg-primary" style={{ flex: receivable }} />
          <View className="bg-payable" style={{ flex: payable }} />
        </View>
      ) : (
        <View className="h-1.25 bg-outline" />
      )}

      <View className="flex-row items-center justify-between gap-2.5 bg-surface-muted/60 px-3.5 py-2">
        <Text className="font-sans text-[11px] font-semibold text-muted">
          Previsto{" "}
          <Text className="font-bold text-ink" style={TABULAR}>
            {summary ? signedMoney(receivable - payable + received - paid) : "—"}
          </Text>
        </Text>
        <Text className="font-sans text-[11px] font-semibold text-muted">
          Realizado{" "}
          <Text className={`font-bold ${realized < 0 ? "text-payable" : "text-success"}`} style={TABULAR}>
            {summary ? signedMoney(realized) : "—"}
          </Text>
        </Text>
      </View>
    </View>
  );
}

function DayBar({ date, today, charges }: { date: string; today: string; charges: ListCharge }) {
  const isToday = date === today;
  const label = feedDayLabel(date, today);
  const relative = !/\d/.test(label);
  const open = openChargesTotal(charges);
  const settled = charges.every((charge) => charge.state === ChargeState.Paid);
  const textClass = isToday ? "text-on-primary" : "text-muted";

  return (
    <View className={`flex-row items-center justify-between px-4.5 py-2 ${isToday ? "bg-primary" : "bg-surface-muted"}`}>
      <View className="flex-row items-center">
        <Text className={`font-sans text-xs font-extrabold uppercase ${textClass}`}>{label}</Text>
        {relative && <Text className={`font-sans text-xs font-extrabold uppercase ${textClass}`}> · {shortDay(date)}</Text>}
      </View>

      {open && <Text className={`font-display text-xs font-bold ${textClass}`}>{formatMoney(open)}</Text>}
      {!open && settled && <Text className={`font-sans text-xs font-bold ${isToday ? "text-on-primary" : "text-success"}`}>liquidado</Text>}
    </View>
  );
}

type ChargeRowProps = {
  charge: ChargeSummary;
  direction: Direction;
  today: string;
  reminded: string | null;
  onOpen: () => void;
  onRemind: () => void;
  onMarkPaid: () => void;
  onDeclare: () => void;
};

function ChargeRow({ charge, direction, today, reminded, onOpen, onRemind, onMarkPaid, onDeclare }: ChargeRowProps) {
  const badges = chargeBadges(charge, today, direction);
  const action = chargeAction(charge, direction);
  const settled = charge.state !== ChargeState.Pending;
  const payable = direction === Direction.Payable;
  const amountClass = settled ? "text-muted" : payable ? "text-payable" : "text-ink";
  const stateClass = settled ? "text-success" : payable ? "text-payable" : "text-muted";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir cobrança ${charge.description}`}
      onPress={onOpen}
      className={`flex-row items-center gap-3 border-b border-outline/60 bg-surface px-[18px] py-3 ${settled ? "opacity-60" : ""}`}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans text-[13.5px] font-bold text-ink" numberOfLines={1}>
          {charge.description} · {charge.counterpartName}
        </Text>

        <View className="flex-row flex-wrap items-center">
          <Text className={`font-sans text-[11.5px] font-medium ${stateClass}`}>{chargeStateLabel(charge, direction)}</Text>
          {badges.map((badge) => (
            <Fragment key={badge.label}>
              <Text className="font-sans text-[11.5px] text-muted"> · </Text>
              <Text className={`font-sans text-[11.5px] font-medium ${TONE_CLASS[badge.tone]}`}>{badge.label}</Text>
            </Fragment>
          ))}
        </View>
      </View>

      <Text className={`font-display text-sm font-bold ${amountClass}`}>{withoutCurrency(formatMoney(charge.amount))}</Text>

      {action?.kind === ChargeActionKind.Remind && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={reminded ?? action.label}
          disabled={reminded !== null}
          onPress={onRemind}
          className="h-[30px] justify-center rounded-[9px] bg-primary-soft px-2.5"
        >
          <Text className="font-sans text-[11.5px] font-extrabold text-primary-strong">{reminded ?? action.label}</Text>
        </Pressable>
      )}

      {action?.kind === ChargeActionKind.MarkPaid && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={onMarkPaid}
          className="h-[30px] justify-center rounded-[9px] bg-success-soft px-2.5"
        >
          <Text className="font-sans text-[11.5px] font-extrabold text-success">{action.label}</Text>
        </Pressable>
      )}

      {action?.kind === ChargeActionKind.DeclarePayment && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={onDeclare}
          className="h-[30px] justify-center rounded-[9px] bg-success-soft px-2.5"
        >
          <Text className="font-sans text-[11.5px] font-extrabold text-success">{action.label}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export function FeedScreen({
  client = financialClient,
  notifications = notificationClient,
  onOpenCharge,
}: FeedScreenProps) {
  const colors = useThemeColors();
  // The whole month, as the API answered it; the filters narrow it down on screen.
  const [charges, setCharges] = useState<ListCharge | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [remindTarget, setRemindTarget] = useState<ChargeSummary | null>(null);
  // The selected month persists across refocus/refresh; only picking another tab resets and reloads.
  const [month, setMonth] = useState(() => currentMonth(new Date()));
  const monthRef = useRef(month);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    async (nextMonth = monthRef.current, quiet = false) => {
      const requestGeneration = ++generation.current;

      setError("");

      // A quiet load keeps the current items on screen while fresh ones arrive (focus and pull to refresh).
      if (!quiet) {
        setLoading(true);
        setCharges(null);
      }

      try {
        const page = await client.charges(nextMonth);

        if (requestGeneration !== generation.current) {
          return;
        }

        setCharges(page);
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
      void load(undefined, true);
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);

    await load(undefined, true);

    setRefreshing(false);
  }, [load]);

  function selectMonth(value: string) {
    if (value === monthRef.current) {
      return;
    }

    setMonth(value);
    monthRef.current = value;
    void load(value);
  }

  async function remind(chargeId: string) {
    try {
      await notifications.remind(chargeId);

      setReminded((current) => ({ ...current, [chargeId]: "Lembrete enviado" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o lembrete.");
    }
  }

  function confirmMarkPaid(charge: ChargeSummary) {
    Alert.alert("Marcar como paga?", "Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois.", [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar paga", onPress: () => void markPaid(charge.id) },
    ]);
  }

  async function markPaid(chargeId: string) {
    if (!client.pay) {
      return;
    }

    try {
      await client.pay(chargeId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a cobrança.");

      return;
    }

    // Totals and the card state both change: a quiet reload keeps the list on screen meanwhile.
    await load(undefined, true);
  }

  function confirmDeclare(charge: ChargeSummary) {
    Alert.alert("Marcar como pago?", `${charge.counterpartName} vai receber um aviso para confirmar o recebimento.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar pago", onPress: () => void declare(charge.id) },
    ]);
  }

  async function declare(chargeId: string) {
    if (!client.declarePayment) {
      return;
    }

    try {
      await client.declarePayment(chargeId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível informar o pagamento.");

      return;
    }

    // The row turns Em análise: a quiet reload keeps the list on screen meanwhile.
    await load(undefined, true);
  }

  const visible = useMemo(() => (charges ? filterCharges(charges, filters, today) : null), [charges, filters, today]);
  const summary = visible ? chargeTotals(visible) : undefined;
  const changedFilters = activeFeedFilterCount(filters);

  // Memoized so the shared native header is only updated when the badge changes.
  const filtersButton = useMemo(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Filtros"
        onPress={() => setFiltersOpen(true)}
        className={`h-[34px] w-[34px] items-center justify-center rounded-xl ${changedFilters ? "bg-primary-soft" : "bg-surface-muted"}`}
      >
        <Image source={slidersMark} tintColor={changedFilters ? colors.primaryStrong : colors.ink} style={{ width: 17, height: 17 }} />
        {changedFilters > 0 && (
          <Text className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center font-sans text-[10px] font-bold text-on-primary">{changedFilters}</Text>
        )}
      </Pressable>
    ),
    [changedFilters, colors.ink, colors.primaryStrong],
  );

  useTabHeader({ title: "Feed", right: filtersButton });

  function row(item: ListChargeItem) {
    const charge = chargeSummaryOf(item);

    return (
      <ChargeRow
        key={item.id}
        charge={charge}
        direction={item.type}
        today={today}
        reminded={reminded[item.id] ?? null}
        onOpen={() => onOpenCharge?.(item.id)}
        onRemind={() => setRemindTarget(charge)}
        onMarkPaid={() => confirmMarkPaid(charge)}
        onDeclare={() => confirmDeclare(charge)}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView
        testID="feed-list"
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primaryStrong} />}
      >
        <View className="gap-3 pt-3">
          <MonthTabsBar month={month} onSelect={selectMonth} />

          <SummaryBox summary={summary} />

          {loading && <ActivityIndicator accessibilityLabel="Carregando feed" className="my-6" color={colors.primary} />}
          {error ? (
            <View className="mx-[18px] gap-2 rounded-xl bg-danger-soft p-4">
              <Text accessibilityRole="alert" className="font-sans text-danger">
                {error}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} className="min-h-12 justify-center">
                <Text className="font-sans font-bold text-danger">Tentar novamente</Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && !error && visible?.length === 0 && (
            <View className="mx-[18px] gap-2 rounded-[18px] border border-outline bg-surface p-5">
              <Text className="font-display text-2xl font-bold text-ink">Sua timeline começa aqui</Text>
              <Text className="font-sans text-sm leading-6 text-muted">Crie uma conta na aba Contas ou entre com o e-mail em que recebeu uma.</Text>
            </View>
          )}

          <View>
            {groupChargesByDay(visible ?? []).map(([date, items]) => (
              <View key={date}>
                <DayBar date={date} today={today} charges={items} />
                {items.map(row)}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {filtersOpen && (
        <FeedFiltersSheet
          value={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFiltersOpen(false);
            setFilters(next);
          }}
        />
      )}

      {remindTarget && (
        <RemindSheet
          charge={remindTarget}
          today={today}
          onClose={() => setRemindTarget(null)}
          onSend={() => {
            setRemindTarget(null);
            void remind(remindTarget.id);
          }}
        />
      )}
    </SafeAreaView>
  );
}
