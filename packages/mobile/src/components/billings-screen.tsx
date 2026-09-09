import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import {
  type BillingDetail,
  type BillingInvite,
  type BillingSummary,
  type BillingsPage,
  billingShareAction,
  calendarDate,
  formatMoney,
  shortDayMonth,
} from "@receivy/common";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { BillingCard } from "./billing-card";
import { BillingFormScreen } from "./billing-form-screen";
import {
  activeBillingChips,
  BillingFiltersSheet,
  DEFAULT_BILLING_FILTERS,
  type BillingFiltersValue,
} from "./billing-filters-sheet";
import { ACTIVE_TINT, MUTED_TINT, TabBar } from "./tab-bar";

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
  onOpenCharge?: (id: string) => void;
  onOpenFeed?: () => void;
  onOpenSettings?: () => void;
};

const stateLabel = { active: "Ativa", paused: "Pausada", ended: "Encerrada" } as const;
const typeLabel = { once: "Uma vez", until: "Até uma data", indefinite: "Sem fim" } as const;

const LIST_ERROR = "Não foi possível carregar suas cobranças.";

const searchMark = require("../../assets/images/auth/search.svg");
const slidersMark = require("../../assets/images/auth/sliders.svg");
const plusMark = require("../../assets/images/auth/plus.svg");

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function listQuery(filters: BillingFiltersValue, search: string, cursor?: string): string {
  const parts = [`state=${filters.state}`];

  if (filters.type) {
    parts.push(`type=${filters.type}`);
  }

  if (filters.category) {
    parts.push(`category=${filters.category}`);
  }

  if (search) {
    parts.push(`search=${encodeURIComponent(search)}`);
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

function HeaderAction({ label, icon, onPress }: { label: string; icon: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-10 flex-row items-center gap-1.5 rounded-full border border-outline bg-surface px-3"
    >
      <Image source={icon} tintColor={MUTED_TINT} style={{ width: 16, height: 16 }} />
      <Text className="text-xs font-bold text-ink">{label}</Text>
    </Pressable>
  );
}

export function BillingsScreen({ client = financialClient, onCreate, onOpenCharge, onOpenFeed, onOpenSettings }: BillingsScreenProps) {
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [filters, setFilters] = useState<BillingFiltersValue>(DEFAULT_BILLING_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BillingDetail | null>(null);
  const [invite, setInvite] = useState<BillingInvite | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return client
        .billings(listQuery(filters, search, cursor))
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
    [client, filters, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);

    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(billingId: string) {
    setError("");

    try {
      const detail = await client.billing(billingId);

      setSelected(detail);
      setInvite(detail.invite);
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : LIST_ERROR);
    }
  }

  async function share(billing: BillingSummary) {
    setError("");

    const chargeId = billing.shareChargeId;

    if (billingShareAction(billing) !== "share" || !chargeId) {
      await open(billing.id);
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

  async function edit(billing: BillingSummary) {
    await open(billing.id);
    setEditing(true);
  }

  async function shareInvite(link: BillingInvite, description: string) {
    await Share.share({ title: "Convite Receivy", message: `Entre na cobrança ${description} no Receivy: ${link.url}` });
  }

  async function createInvite() {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const created = await client.invite(selected.id);

      setInvite(created);
      await shareInvite(created, selected.description);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite() {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await client.revokeInvite(selected.id);
      setInvite(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível revogar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(state: "active" | "paused" | "ended") {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      setSelected(await client.patchBilling(selected.id, { state }));
      setConfirm(false);

      // The server keeps the invite alive after the billing ends, so drop it here; a failure must not block the transition.
      if (state === "ended" && invite) {
        await client.revokeInvite(selected.id).catch(() => undefined);
        setInvite(null);
      }

      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a cobrança.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <BillingFormScreen
        client={client}
        billing={selected}
        onSaved={(saved) => {
          setSelected(saved);
          setEditing(false);
          void load();
        }}
        onBack={() => setEditing(false)}
      />
    );
  }

  if (selected) {
    const canPause = selected.type === "indefinite" && selected.state !== "ended";

    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          <View className="gap-5 p-5">
            <Button
              label="Todas as cobranças"
              onPress={() => {
                setSelected(null);
                setConfirm(false);
              }}
            />

            <Text accessibilityRole="header" className="text-3xl font-extrabold text-primary-strong">
              {selected.description}
            </Text>
            <Text className="text-muted">
              {typeLabel[selected.type]} · {stateLabel[selected.state]}
            </Text>
            <Text className="text-3xl font-extrabold text-ink">{formatMoney(selected.total)} por cobrança</Text>

            {selected.state !== "ended" && (
              <View className="gap-2">
                <Button label="Editar" disabled={busy} onPress={() => setEditing(true)} />
                {selected.state === "active" && <Button label="Convidar" disabled={busy} onPress={() => void createInvite()} />}
                {canPause && (
                  <Button
                    label={selected.state === "active" ? "Pausar" : "Reativar"}
                    disabled={busy}
                    onPress={() => void transition(selected.state === "active" ? "paused" : "active")}
                  />
                )}
                <Button label="Encerrar" disabled={busy} onPress={() => setConfirm(true)} />
              </View>
            )}

            {invite && selected.state === "active" && (
              <View className="gap-2 rounded-2xl border border-outline/40 bg-surface p-4">
                <Text className="text-sm font-semibold text-ink">Convite ativo até {shortDayMonth(invite.expiresAt)}</Text>
                <Button label="Compartilhar convite" disabled={busy} onPress={() => void shareInvite(invite, selected.description)} />
                <Button label="Revogar" disabled={busy} onPress={() => void revokeInvite()} />
              </View>
            )}

            {confirm && (
              <View className="gap-3 rounded-xl border border-outline p-4">
                <Text>Encerrar cancela as cobranças pendentes e impede novas ocorrências. Esta ação não pode ser desfeita.</Text>
                <Button label="Confirmar encerramento" primary disabled={busy} onPress={() => void transition("ended")} />
                <Button label="Voltar" onPress={() => setConfirm(false)} />
              </View>
            )}

            {error ? (
              <Text accessibilityRole="alert" className="text-red-700">
                {error}
              </Text>
            ) : null}

            <Text className="text-2xl font-bold text-primary-strong">Cobranças geradas</Text>
            {!selected.charges.length && <Text className="text-muted">Nenhuma cobrança gerada ainda.</Text>}
            {selected.charges.map((charge) => (
              <Pressable
                key={charge.id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir cobrança de ${charge.recipient.name}`}
                onPress={() => onOpenCharge?.(charge.id)}
                className="gap-1 rounded-2xl border border-outline bg-surface p-4"
              >
                <Text className="font-bold text-ink">
                  {charge.recipient.name} · {formatMoney(charge.amount)}
                </Text>
                <Text className="text-sm text-muted">
                  {dateText(charge.dueDate)} · {charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}
                  {charge.installmentCount && charge.installmentCount > 1 ? ` · ${charge.installment}/${charge.installmentCount}` : ""}
                </Text>
              </Pressable>
            ))}

            {selected.type === "indefinite" && (
              <>
                <Text className="text-2xl font-bold text-primary-strong">Próximas ocorrências</Text>
                <Text className="text-muted">
                  Ainda não são cobranças. Projeções não entram no saldo nem permitem pagamento, comprovante ou link.
                </Text>
                {selected.previews.map((preview) => (
                  <Text key={preview.occurrenceDate}>
                    {dateText(preview.occurrenceDate)} · {formatMoney(preview.amount)}
                  </Text>
                ))}
              </>
            )}
          </View>
        </ScrollView>

        <TabBar active="Cobranças" onOpenFeed={onOpenFeed} onOpenSettings={onOpenSettings} />
      </SafeAreaView>
    );
  }

  const chips = activeBillingChips(filters);

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top"]}>
      <View className="gap-3 px-5 pb-2 pt-3">
        <View className="flex-row items-center gap-2">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Text className="text-lg font-extrabold text-white">R</Text>
          </View>
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-xl font-extrabold text-primary-strong">
              Minhas Cobranças
            </Text>
            <Text className="text-xs text-muted">Cobranças cadastradas e links</Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          <HeaderAction
            label="Buscar"
            icon={searchMark}
            onPress={() => {
              setSearchOpen(!searchOpen);
              setTerm("");
            }}
          />
          <HeaderAction label="Filtros" icon={slidersMark} onPress={() => setFiltersOpen(true)} />
        </View>

        {searchOpen && (
          <TextInput
            accessibilityLabel="Buscar por título ou descrição"
            placeholder="Buscar por título ou descrição…"
            placeholderTextColor={MUTED_TINT}
            value={term}
            onChangeText={setTerm}
            className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
          />
        )}

        {chips.length > 0 && (
          <View className="flex-row flex-wrap gap-2">
            {chips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityRole="button"
                accessibilityLabel={`Remover filtro ${chip.label}`}
                onPress={() => setFilters({ ...filters, [chip.key]: DEFAULT_BILLING_FILTERS[chip.key] })}
                className="min-h-9 justify-center rounded-full bg-primary-soft/50 px-3"
              >
                <Text className="text-xs font-bold text-primary-strong">{chip.label} ×</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View className="gap-3 px-5 pt-2">
          {!page && !error && <ActivityIndicator accessibilityLabel="Carregando cobranças" className="my-6" color={ACTIVE_TINT} />}

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
              <Text className="text-2xl font-extrabold text-primary-strong">Nenhuma cobrança ainda</Text>
              <Text className="text-sm leading-6 text-muted">Crie a primeira para acompanhar os vencimentos.</Text>
              <Button label="Nova cobrança" primary onPress={() => onCreate?.()} />
            </View>
          )}

          {page?.billings.map((billing) => (
            <BillingCard
              key={billing.id}
              billing={billing}
              today={today}
              onShare={(target) => void share(target)}
              onEdit={(target) => void edit(target)}
              onOpen={(target) => void open(target.id)}
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nova cobrança"
        onPress={() => onCreate?.()}
        className="absolute bottom-24 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary"
      >
        <Image source={plusMark} tintColor="#FFFFFF" style={{ width: 22, height: 22 }} />
      </Pressable>

      {filtersOpen && (
        <BillingFiltersSheet
          value={filters}
          onApply={(next) => {
            setFilters(next);
            setFiltersOpen(false);
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <TabBar active="Cobranças" onOpenFeed={onOpenFeed} onOpenSettings={onOpenSettings} />
    </SafeAreaView>
  );
}
