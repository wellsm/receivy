import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import {
  activeBillingFilterCount,
  type AuthUser,
  type BillingListFilters,
  BillingState,
  type BillingsPage,
  calendarDate,
  DEFAULT_BILLING_LIST_FILTERS,
  filterBillings,
} from "@receivy/common";
import { profileStore, type ProfileStore } from "@/account/profile";
import { BillingFiltersSheet } from "@/components/app/billing-filters-sheet";
import { SearchFooter } from "@/components/app/search-footer";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { BillingCard } from "@/components/ui/billing-card";
import { useThemeColors } from "@/theme/colors";

type BillingsScreenProps = {
  client?: Pick<FinancialClient, "billings">;
  profile?: Pick<ProfileStore, "load">;
  onBack?: () => void;
  onCreate?: () => void;
  onOpenBilling?: (id: string) => void;
  onOpenProfile?: () => void;
};

const LIST_ERROR = "Não foi possível carregar suas contas.";

/** Client-side state tabs over the loaded pages; the counts beside them come from the API. */
const STATE_TABS: { value: BillingState; label: string; empty: string }[] = [
  { value: BillingState.Active, label: "Ativas", empty: "Nenhuma conta ativa." },
  { value: BillingState.Paused, label: "Pausadas", empty: "Nenhuma conta pausada." },
  { value: BillingState.Ended, label: "Encerradas", empty: "Nenhuma conta encerrada." },
];

const chevronMark = require("../../../assets/images/auth/chevron.svg");

/** Only the search goes to the API; type, frequency and category filter the loaded pages. */
function listQuery(search: string, cursor?: string): string {
  const parts: string[] = [];

  if (search) {
    parts.push(`search=${encodeURIComponent(search)}`);
  }

  if (cursor) {
    parts.push(`cursor=${encodeURIComponent(cursor)}`);
  }

  return parts.join("&");
}

export function BillingsScreen({ client = financialClient, profile = profileStore, onBack, onCreate, onOpenBilling, onOpenProfile }: BillingsScreenProps) {
  const colors = useThemeColors();
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<BillingState>(BillingState.Active);
  const [filters, setFilters] = useState<BillingListFilters>(DEFAULT_BILLING_LIST_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const requests = useRef(0);
  const today = calendarDate();

  useEffect(() => {
    profile
      .load()
      .then(setUser)
      .catch(() => undefined);
  }, [profile]);

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return client
        .billings(listQuery(search, cursor))
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
    [client, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);

    return () => clearTimeout(timer);
  }, [term]);

  // The detail routes sit on top of the list: an ended or edited billing must be gone when the list comes back.
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

  const visible = page ? filterBillings(page.billings, stateFilter, filters) : [];
  const tab = STATE_TABS.find((option) => option.value === stateFilter) ?? STATE_TABS[0]!;
  const counts = page?.counts;
  const name = user?.name?.trim() || "R";

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <View className="gap-3 pt-3">
        <View className="mx-[18px] flex-row items-center gap-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Voltar para o Feed" onPress={onBack} className="h-10 w-10 items-center justify-center rounded-xl bg-surface-muted">
            <Image source={chevronMark} tintColor={colors.ink} style={{ width: 18, height: 18, transform: [{ rotate: "180deg" }] }} />
          </Pressable>

          <View className="min-w-0 flex-1">
            {counts ? (
              <Text className="font-sans text-xs text-muted" numberOfLines={1}>
                {counts.active} {counts.active === 1 ? "ativa" : "ativas"} · {counts.monthCharges} {counts.monthCharges === 1 ? "cobrança" : "cobranças"} no mês
              </Text>
            ) : null}
            <Text accessibilityRole="header" className="font-display text-[22px] font-bold text-ink">
              Contas
            </Text>
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="Perfil" onPress={onOpenProfile}>
            <InitialsAvatar name={name} size={40} avatar={user?.avatar} />
          </Pressable>
        </View>

        <View accessibilityRole="tablist" className="mx-[18px] flex-row border-b border-outline">
          {STATE_TABS.map((option) => {
            const selected = option.value === stateFilter;
            const count = counts?.[option.value];

            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => setStateFilter(option.value)}
                className={`flex-1 items-center pb-[7px] pt-[7px] ${selected ? "border-b-[2.5px] border-primary" : ""}`}
              >
                <Text className={`font-sans ${selected ? "text-[13.5px] font-extrabold text-ink" : "text-xs font-bold text-muted"}`}>{option.label}</Text>
                {count !== undefined && <Text className={`font-sans text-[11px] font-semibold ${selected ? "text-primary" : "text-muted"}`}>{count}</Text>}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primaryStrong} />}
      >
        <View className="gap-2.5 px-[18px] pt-3">
          {!page && !error && <ActivityIndicator accessibilityLabel="Carregando contas" className="my-6" color={colors.primaryStrong} />}

          {error ? (
            <View className="gap-2 rounded-xl bg-danger-soft p-4">
              <Text accessibilityRole="alert" className="font-sans text-danger">
                {error}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={() => void load()} className="min-h-12 justify-center">
                <Text className="font-sans font-bold text-danger">Tentar novamente</Text>
              </Pressable>
            </View>
          ) : null}

          {page && !page.billings.length && !search && (
            <View className="gap-2 rounded-[20px] border border-outline bg-surface p-5">
              <Text className="font-display text-2xl font-bold text-ink">Nenhuma conta ainda</Text>
              <Text className="font-sans text-sm leading-6 text-muted">Toque no + para criar a primeira e acompanhar os vencimentos.</Text>
            </View>
          )}

          {page && (page.billings.length > 0 || !!search) && !visible.length && <Text className="py-6 text-center font-sans text-sm text-muted">{tab.empty}</Text>}

          {visible.map((billing) => (
            <BillingCard key={billing.id} billing={billing} today={today} onOpen={(target) => onOpenBilling?.(target.id)} />
          ))}

          {page?.nextCursor && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Carregar mais"
              onPress={() => void load(page.nextCursor ?? undefined)}
              className="min-h-12 items-center justify-center rounded-xl border border-outline"
            >
              <Text className="font-sans font-bold text-primary">Carregar mais</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      <SearchFooter
        placeholder="Buscar conta"
        value={term}
        onChangeText={setTerm}
        filterCount={activeBillingFilterCount(filters)}
        onFilter={() => setFiltersOpen(true)}
        onCreate={() => onCreate?.()}
      />

      {filtersOpen && (
        <BillingFiltersSheet
          value={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFiltersOpen(false);
            setFilters(next);
          }}
        />
      )}
    </SafeAreaView>
  );
}
