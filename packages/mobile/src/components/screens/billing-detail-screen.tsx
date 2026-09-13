import { useCallback, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import {
  billingCategoryLabel,
  BillingState,
  calendarDate,
  chargeShareText,
  formatMoney,
  type BillingDetail,
  type BillingGuest,
  type BillingGuestAction,
  type BillingInvite,
  type ChargeDetail,
  type Money,
  type PaymentMethod,
  type PixKeyType,
  type PixSnapshot,
} from "@receivy/common";
import { Toast } from "@/components/app/toast";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { ActionTile } from "@/components/ui/action-tile";
import { CategoryIcon } from "@/components/ui/category-icon";
import { CopyButton } from "@/components/ui/copy-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { financialClient, type FinancialClient } from "@/financial/client";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

type Client = Pick<
  FinancialClient,
  "billing" | "patchBilling" | "invite" | "revokeInvite" | "resolveGuest" | "publicLink" | "publicChargeUrl" | "paymentMethods" | "pay" | "reopen" | "reviewProof"
>;

type BillingDetailScreenProps = {
  id: string;
  client?: Client;
  onOpenCharge?: (chargeId: string) => void;
  onEdit?: (billing: BillingDetail) => void;
};

/** One due date of the billing: the charges generated for it, oldest cycle first. */
type Cycle = {
  dueDate: string;
  index: number;
  charges: ChargeDetail[];
};

const LOAD_ERROR = "Não foi possível carregar a conta.";

const STATE_LABELS = { active: "Ativa", paused: "Pausada", ended: "Encerrada" } as const;

const PIX_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Celular",
  random: "Aleatória",
};

const ICONS = {
  check: require("../../../assets/images/auth/check.svg"),
  edit: require("../../../assets/images/auth/edit.svg"),
  group: require("../../../assets/images/auth/group.svg"),
  key: require("../../../assets/images/auth/key.svg"),
  more: require("../../../assets/images/auth/more.svg"),
  bell: require("../../../assets/images/auth/bell.svg"),
  share: require("../../../assets/images/auth/share.svg"),
  warning: require("../../../assets/images/auth/warning.svg"),
  pause: require("../../../assets/images/auth/pause.svg"),
  play: require("../../../assets/images/auth/play.svg"),
  stop: require("../../../assets/images/auth/stop.svg"),
  receipt: require("../../../assets/images/auth/receipt.svg"),
} as const;

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function dayMonth(value: string): string {
  return dateText(value).slice(0, 5);
}

function paidAtText(iso: string, timezone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(date);

  return `Pago em ${day} às ${time}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function money(amountCents: number, currency: Money["currency"] = "BRL"): string {
  return formatMoney({ amountCents, currency });
}

/** A billing without generated charges still points at its key; the wallet turns the id into something readable. */
function pixFromWallet(methods: PaymentMethod[], paymentMethodId: string | undefined): PixSnapshot | null {
  const method = methods.find((candidate) => candidate.id === paymentMethodId);

  return method ? { keyType: method.pixKeyType, key: method.pixKey, label: method.label } : null;
}

function cyclesOf(billing: BillingDetail): Cycle[] {
  const groups = new Map<string, ChargeDetail[]>();

  for (const charge of billing.charges) {
    groups.set(charge.dueDate, [...(groups.get(charge.dueDate) ?? []), charge]);
  }

  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dueDate, charges], index) => ({ dueDate, index: index + 1, charges }));
}

/** The cycle the owner is collecting now: the latest one with something pending, else the last one. */
function currentCycle(cycles: Cycle[]): Cycle | null {
  return [...cycles].reverse().find((cycle) => cycle.charges.some((charge) => charge.state === "pending")) ?? cycles.at(-1) ?? null;
}

function cycleTotals(cycle: Cycle): { paid: number; goal: number; paidCount: number; open: number } {
  const open = cycle.charges.filter((charge) => charge.state !== "cancelled");
  const paidCharges = open.filter((charge) => charge.state === "paid");

  return {
    paid: paidCharges.reduce((sum, charge) => sum + charge.amount.amountCents, 0),
    goal: open.reduce((sum, charge) => sum + charge.amount.amountCents, 0),
    paidCount: paidCharges.length,
    open: open.length,
  };
}

function cycleTitle(billing: BillingDetail, cycle: Cycle): string {
  if (billing.type === "until") {
    const installment = cycle.charges[0]?.installment ?? cycle.index;
    const count = billing.installmentCount ?? cycle.charges[0]?.installmentCount ?? cycle.index;

    return `Parcela ${installment} de ${count}`;
  }

  if (billing.type === "indefinite") {
    return `Ocorrência ${dateText(cycle.dueDate)}`;
  }

  return "Cobrança única";
}

function cycleState(cycle: Cycle): "open" | "done" | "cancelled" {
  const { open, paidCount } = cycleTotals(cycle);

  if (!open) {
    return "cancelled";
  }

  return paidCount === open ? "done" : "open";
}

function typeTag(billing: BillingDetail, current: Cycle | null): string {
  const monthEnd = billing.dueRule === "end_of_month" ? " · final do mês" : "";

  if (billing.type === "until") {
    const installment = current?.charges[0]?.installment ?? current?.index ?? 1;

    return `Parcelado (${installment}/${billing.installmentCount ?? "?"})${monthEnd}`;
  }

  if (billing.type === "indefinite") {
    return billing.frequency === "yearly" ? "Recorrente anual" : `Recorrente mensal${monthEnd}`;
  }

  return "À vista";
}

function Tag({ label, tone }: { label: string; tone: "success" | "warning" | "info" | "neutral" | "danger" }) {
  const classes = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
    neutral: "border-outline/30 bg-surface-muted text-muted",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[tone];

  return <Text className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${classes}`}>{label}</Text>;
}

export function BillingDetailScreen({ id, client = financialClient, onOpenCharge, onEdit }: BillingDetailScreenProps) {
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [invite, setInvite] = useState<BillingInvite | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [chooser, setChooser] = useState(false);
  // The guest whose answer is in flight: only that card locks while the others stay answerable.
  const [resolvingGuest, setResolvingGuest] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;

    // The wallet only names the key of a billing that has no charge yet; losing it must not hide the billing.
    Promise.all([client.billing(id), client.paymentMethods().catch(() => ({ paymentMethods: [] }))])
      .then(([detail, wallet]) => {
        if (!live) {
          return;
        }

        setBilling(detail);
        setInvite(detail.invite);
        setMethods(wallet.paymentMethods);
        setError("");
      })
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR));

    return () => {
      live = false;
    };
  }, [client, id]);

  // The edit route sits on top of this one, so every return refreshes the numbers.
  useFocusEffect(load);

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      return await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function shareInvite(link: BillingInvite, description: string) {
    await Share.share({ title: "Convite Receivy", message: `Entre na conta ${description} no Receivy: ${link.url}` });
  }

  async function inviteSomeone(detail: BillingDetail) {
    if (invite) {
      await run(() => shareInvite(invite, detail.description), "Não foi possível compartilhar o convite.");
      return;
    }

    await run(async () => {
      const created = await client.invite(detail.id);

      setInvite(created);
      await shareInvite(created, detail.description);
    }, "Não foi possível criar o convite.");
  }

  async function revokeInvite(detail: BillingDetail) {
    await run(async () => {
      await client.revokeInvite(detail.id);
      setInvite(null);
    }, "Não foi possível revogar o convite.");
  }

  async function resolveGuest(detail: BillingDetail, guest: BillingGuest, action: BillingGuestAction) {
    setResolvingGuest(guest.id);

    try {
      await run(async () => {
        const updated = await client.resolveGuest(detail.id, guest.id, action);

        setBilling(updated);
      }, "Não foi possível resolver o convidado.");
    } finally {
      setResolvingGuest(null);
    }
  }

  async function transition(detail: BillingDetail, state: BillingState) {
    await run(async () => {
      const updated = await client.patchBilling(detail.id, { state });

      setBilling(updated);
      setConfirmEnd(false);

      // The server keeps the invite alive after the billing ends, so drop it here; a failure must not block the transition.
      if (state === "ended" && invite) {
        await client.revokeInvite(detail.id).catch(() => undefined);
        setInvite(null);
      }
    }, "Não foi possível atualizar a conta.");
  }

  async function shareCharge(charge: ChargeDetail) {
    setChooser(false);

    await run(async () => {
      const link = await client.publicLink(charge.id);
      const url = client.publicChargeUrl(link.token);

      await Share.share({ title: "Cobrança Receivy", message: chargeShareText(charge, url), url });
    }, "Não foi possível compartilhar o link.");
  }

  async function reloadBilling() {
    const detail = await client.billing(id);

    setBilling(detail);
    setInvite(detail.invite);
  }

  /** A file under review is accepted instead of paid outright, so the proof history stays consistent. */
  async function settle(charge: ChargeDetail) {
    if (charge.proofState !== "pending") {
      await client.pay(charge.id);
      return;
    }

    await client.reviewProof(charge.id, "accepted");
  }

  function confirmPaid(charge: ChargeDetail, name: string) {
    Alert.alert("Marcar como paga?", "Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Marcar paga",
        onPress: () =>
          void run(async () => {
            await settle(charge);
            await reloadBilling();
            setNotice(`Pagamento de ${name} registrado.`);
          }, "Não foi possível atualizar a cobrança."),
      },
    ]);
  }

  function confirmReopen(charge: ChargeDetail) {
    Alert.alert("Reabrir cobrança?", "O pagamento registrado é removido e a cobrança volta a ficar pendente. Um comprovante aceito volta para revisão.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Reabrir",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await client.reopen(charge.id);
            await reloadBilling();
          }, "Não foi possível reabrir a cobrança."),
      },
    ]);
  }

  if (!billing) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas" edges={["bottom"]}>
        {error ? (
          <View className="gap-3 px-5">
            <Text accessibilityRole="alert" className="text-center text-red-700">
              {error}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={load} className="min-h-12 items-center justify-center">
              <Text className="font-bold text-primary">Tentar novamente</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator accessibilityLabel="Carregando conta" color={ACTIVE_TINT} size="large" />
        )}
      </SafeAreaView>
    );
  }

  const today = calendarDate(new Date(), billing.timezone);
  const cycles = cyclesOf(billing);
  const current = currentCycle(cycles);
  const totals = current ? cycleTotals(current) : { paid: 0, goal: billing.total.amountCents, paidCount: 0, open: 0 };
  const goal = totals.goal || billing.total.amountCents;
  const progress = goal ? Math.min(100, Math.floor((totals.paid / goal) * 100)) : 0;
  const pending = current?.charges.filter((charge) => charge.state === "pending") ?? [];
  const payable = billing.direction === "payable";
  // A conta a pagar carries its own key; a conta a receber points at one of the wallet.
  const pix = payable ? billing.pix : (billing.charges.find((charge) => charge.pix)?.pix ?? pixFromWallet(methods, billing.paymentMethodId));
  const ended = billing.state === "ended";
  // The owner shares links and reminds only on a conta a receber.
  const collecting = !payable && !ended;
  const currency = billing.total.currency;
  const stateTone = billing.state === "active" ? "success" : billing.state === "paused" ? "warning" : "neutral";

  function statusLine(charge: ChargeDetail): { text: string; tone: "success" | "warning" | "danger" | "neutral" } {
    if (charge.state === "paid") {
      return { text: charge.paidAt ? paidAtText(charge.paidAt, billing!.timezone) : "Pago", tone: "success" };
    }

    if (charge.state === "cancelled") {
      return { text: "Cancelada", tone: "neutral" };
    }

    const late = daysBetween(charge.dueDate, today);

    if (late > 0) {
      return { text: `Atrasada há ${late} dia${late === 1 ? "" : "s"}`, tone: "danger" };
    }

    return { text: late === 0 ? "Vence hoje" : `Vence em ${dayMonth(charge.dueDate)}`, tone: "warning" };
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-4" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </Text>
        ) : null}

        {/* Hero */}
        <View className="gap-3 overflow-hidden rounded-2xl border border-outline/30 bg-surface p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <View className="flex-row items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1">
                <CategoryIcon category={billing.category} size={14} />
                <Text className="text-[11px] font-medium text-muted">{billingCategoryLabel(billing.category)}</Text>
              </View>
              <Text className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900">{typeTag(billing, current)}</Text>
              {payable && <Text className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-900">A pagar</Text>}
            </View>
            <Tag label={STATE_LABELS[billing.state]} tone={stateTone} />
          </View>

          <Text accessibilityRole="header" className="text-[22px] font-bold tracking-tight text-primary-strong">
            {billing.description}
          </Text>

          <Text className="text-xs text-muted">
            {ended ? "Sem próximos vencimentos" : "Próx. vencimento: "}
            {!ended && <Text className="font-semibold text-ink">{billing.nextDueDate ? dateText(billing.nextDueDate) : "sem data"}</Text>}
          </Text>

          <View className="gap-2 rounded-xl border border-outline/20 bg-surface-muted/70 p-3.5">
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-[11px] text-muted">{payable ? "Total pago" : "Total Recebido"}</Text>
                <Text className="text-lg font-bold text-primary-strong">{money(totals.paid, currency)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-[11px] text-muted">Meta da Rodada</Text>
                <Text className="text-sm font-semibold text-ink">{money(goal, currency)}</Text>
              </View>
            </View>
            <View className="h-2.5 overflow-hidden rounded-full bg-outline/30">
              <View className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-[11px] font-semibold text-primary">{progress}% liquidado</Text>
              <Text className="text-[11px] text-muted">Falta {money(Math.max(0, goal - totals.paid), currency)}</Text>
            </View>
          </View>

          <View className="flex-row items-center justify-between border-t border-outline/20 pt-3">
            <View className="flex-1 flex-row items-center gap-1.5">
              <Image source={ICONS.key} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
              {/* Only the owner reaches this screen, so the key itself is safe to show here. */}
              <Text className="flex-1 text-[11px] text-muted" numberOfLines={1}>
                {pix ? (
                  <>
                    {`Pix - ${PIX_TYPE_LABELS[pix.keyType]}: `}
                    <Text className="font-medium text-ink">{pix.key}</Text>
                  </>
                ) : (
                  "Sem chave Pix vinculada"
                )}
              </Text>
            </View>
            {pix && <CopyButton value={pix.key} accessibilityLabel="Copiar chave Pix" onRefused={() => setError("Não foi possível copiar a chave.")} />}
          </View>
        </View>

        {!ended && (
          <View className="gap-2.5">
            <View className="flex-row gap-2">
              <ActionTile
                label="Editar"
                icon={ICONS.edit}
                hint={payable ? "Categoria, Pix e lembretes" : billing.type === "indefinite" ? "Valor e pessoas do próximo ciclo" : "Categoria e Pix"}
                disabled={busy}
                onPress={() => onEdit?.(billing)}
              />
              {!payable && billing.state === "active" && (
                <ActionTile label="Convidar" icon={ICONS.group} hint="Compartilha um convite para entrar na conta" disabled={busy} onPress={() => void inviteSomeone(billing)} />
              )}
              {billing.type === "indefinite" && (
                <ActionTile
                  label={billing.state === "active" ? "Pausar" : "Retomar"}
                  icon={billing.state === "active" ? ICONS.pause : ICONS.play}
                  hint={billing.state === "active" ? "Suspende as próximas ocorrências" : "Volta a gerar ocorrências"}
                  disabled={busy}
                  onPress={() => void transition(billing, billing.state === "active" ? BillingState.Paused : BillingState.Active)}
                />
              )}
              <ActionTile label="Encerrar" icon={ICONS.stop} tone="danger" hint="Cancela as pendentes e impede novas ocorrências" disabled={busy} onPress={() => setConfirmEnd(true)} />
            </View>
            {!payable && invite && billing.state === "active" && (
              <View className="flex-row items-center justify-between px-1">
                <Text className="text-[11px] text-muted">Convite ativo até {dayMonth(invite.expiresAt.slice(0, 10))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Revogar convite" disabled={busy} onPress={() => void revokeInvite(billing)} className="min-h-8 justify-center">
                  <Text className="text-[11px] font-semibold text-red-700">Revogar convite</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Convidados: people who came in by the link and wait for the owner to say who they are */}
        {billing.guests.length > 0 && (
          <View className="gap-3 rounded-2xl border border-outline/40 bg-surface p-4">
            <Text className="text-lg font-semibold text-primary-strong">Aguardando você</Text>

            {billing.guests.map((guest) => {
              const locked = resolvingGuest === guest.id;

              return (
                <View key={guest.id} className="gap-2.5 border-t border-outline/20 pt-3">
                  <View>
                    <Text className="text-sm font-bold text-ink" numberOfLines={1}>
                      {guest.name}
                    </Text>
                    <Text className="text-xs text-muted" numberOfLines={1}>
                      {guest.email}
                    </Text>
                  </View>

                  <Text className="text-xs text-muted">Entrou pelo link. Quem é essa pessoa?</Text>

                  {billing.linkableContacts.length > 0 && (
                    <View className="flex-row flex-wrap gap-2">
                      {billing.linkableContacts.map((candidate) => (
                        <Pressable
                          key={candidate.contactId}
                          accessibilityRole="button"
                          accessibilityLabel={`É ${candidate.displayName}`}
                          accessibilityState={{ disabled: locked }}
                          disabled={locked}
                          onPress={() => void resolveGuest(billing, guest, { action: "link", contactId: candidate.contactId })}
                          className={`min-h-9 justify-center rounded-full border border-primary/40 bg-primary-soft/40 px-3 ${locked ? "opacity-50" : ""}`}
                        >
                          <Text className="text-xs font-semibold text-primary-strong">É {candidate.displayName}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  <View className="flex-row items-center gap-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Novo participante ${guest.name}`}
                      accessibilityState={{ disabled: locked }}
                      disabled={locked}
                      onPress={() => void resolveGuest(billing, guest, { action: "add" })}
                      className={`min-h-9 justify-center rounded-lg bg-primary px-3 ${locked ? "opacity-50" : ""}`}
                    >
                      <Text className="text-xs font-semibold text-white">Novo participante</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Ignorar ${guest.name}`}
                      accessibilityState={{ disabled: locked }}
                      disabled={locked}
                      onPress={() => void resolveGuest(billing, guest, { action: "dismiss" })}
                      className="min-h-9 justify-center px-2"
                    >
                      <Text className="text-xs font-semibold text-muted">Ignorar</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Participantes: on a conta a pagar, the owner's own charges */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-semibold text-primary-strong">{payable ? "Cobranças" : "Participantes"}</Text>
              <Text className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-primary-strong">{current?.charges.length ?? 0}</Text>
            </View>
            {current && billing.type !== "once" && (
              <Text className="text-[11px] text-muted">
                {billing.type === "until" ? `Ciclo ${current.charges[0]?.installment ?? current.index} de ${billing.installmentCount ?? "?"}` : `Ciclo ${current.index}`}
              </Text>
            )}
          </View>

          {!current && <Text className="text-sm text-muted">Nenhuma cobrança gerada ainda.</Text>}

          {current?.charges.map((charge) => {
            const status = statusLine(charge);
            const isPending = charge.state === "pending";
            // A file under review changes what the row asks of the owner: review it, never nag.
            const reviewing = isPending && charge.proofState === "pending";
            const statusColor = { success: "text-primary", warning: "text-amber-700", danger: "text-red-700", neutral: "text-muted" }[status.tone];
            const name = payable ? (billing.payee?.name ?? "Só comigo") : charge.recipient.name;

            return (
              <View
                key={charge.id}
                className={`gap-2.5 rounded-xl border border-outline/30 bg-surface p-3.5 ${isPending ? "border-l-4 border-l-amber-400" : ""}`}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir cobrança de ${name}`}
                  onPress={() => onOpenCharge?.(charge.id)}
                  className="flex-row items-center justify-between gap-3"
                >
                  <View className="flex-1 flex-row items-center gap-3">
                    <InitialsAvatar name={name} size={40} />
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                        {name}
                      </Text>
                      <Text className={`text-[11px] font-medium ${statusColor}`}>{status.text}</Text>
                    </View>
                  </View>
                  <View className="items-end gap-1">
                    <Text className="text-sm font-semibold text-ink">{formatMoney(charge.amount)}</Text>
                    <Tag
                      label={charge.state === "paid" ? "Pago" : reviewing ? "Em revisão" : charge.state === "pending" ? "Pendente" : "Cancelada"}
                      tone={charge.state === "paid" ? "success" : reviewing ? "info" : charge.state === "pending" ? "warning" : "neutral"}
                    />
                  </View>
                </Pressable>

                {reviewing && (
                  <View className="flex-row items-center justify-between border-t border-outline/20 pt-2.5">
                    <View className="flex-row items-center gap-1">
                      <Image source={ICONS.receipt} tintColor={ACTIVE_TINT} style={{ width: 13, height: 13 }} />
                      <Text className="text-[11px] font-medium text-primary-strong">Comprovante em revisão</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Marcar ${name} como pago`}
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        onPress={() => confirmPaid(charge, name)}
                        className={`min-h-8 flex-row items-center gap-1.5 rounded-lg border border-outline/50 px-3 ${busy ? "opacity-50" : ""}`}
                      >
                        <Text className="text-[11px] font-semibold text-ink">Marcar pago</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Revisar comprovante de ${name}`}
                        onPress={() => onOpenCharge?.(charge.id)}
                        className="min-h-8 flex-row items-center gap-1.5 rounded-lg bg-primary px-3"
                      >
                        <Text className="text-[11px] font-semibold text-white">Revisar</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {isPending && !reviewing && collecting && (
                  <View className="flex-row items-center justify-between border-t border-outline/20 pt-2.5">
                    <View className="flex-row items-center gap-1">
                      <Image source={ICONS.bell} tintColor="#92400e" style={{ width: 13, height: 13 }} />
                      <Text className="text-[11px] font-medium text-amber-800">Aguardando pagamento</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Marcar ${name} como pago`}
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        onPress={() => confirmPaid(charge, name)}
                        className={`min-h-8 flex-row items-center gap-1.5 rounded-lg border border-outline/50 px-3 ${busy ? "opacity-50" : ""}`}
                      >
                        <Text className="text-[11px] font-semibold text-ink">Marcar pago</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Compartilhar link de ${name}`}
                        accessibilityState={{ disabled: busy }}
                        disabled={busy}
                        onPress={() => void shareCharge(charge)}
                        className={`h-8 w-8 items-center justify-center rounded-lg bg-primary ${busy ? "opacity-50" : ""}`}
                      >
                        <Image source={ICONS.share} tintColor="#FFFFFF" style={{ width: 14, height: 14 }} />
                      </Pressable>
                    </View>
                  </View>
                )}

                {charge.state === "paid" && (
                  <View className="flex-row items-center justify-end border-t border-outline/20 pt-2.5">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Reabrir cobrança de ${name}`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => confirmReopen(charge)}
                      className={`min-h-8 justify-center px-1 ${busy ? "opacity-50" : ""}`}
                    >
                      <Text className="text-[11px] font-semibold text-primary">Reabrir</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Histórico */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-primary-strong">Histórico de cobranças</Text>
            <Text className="text-[11px] text-muted">
              Total: {cycles.length} ciclo{cycles.length === 1 ? "" : "s"}
            </Text>
          </View>

          {billing.type === "indefinite" &&
            billing.previews.map((preview) => (
              <View key={preview.occurrenceDate} className="flex-row items-center justify-between rounded-xl border border-dashed border-outline/40 bg-surface/70 p-3.5">
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-surface-muted">
                    <Image source={ICONS.more} tintColor={MUTED_TINT} style={{ width: 18, height: 18 }} />
                  </View>
                  <View>
                    <Text className="text-xs font-semibold text-ink">Próxima • {dateText(preview.occurrenceDate)}</Text>
                    <View>
                      <Text className="text-[11px] text-muted">
                        {formatMoney(preview.amount)} {payable ? "a pagar" : "a receber"}
                      </Text>
                    </View>
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Text className="text-sm font-semibold text-ink">{formatMoney(billing.total)}</Text>
                  <Tag label="Projeção" tone="neutral" />
                </View>
              </View>
            ))}

          {!cycles.length && <Text className="text-sm text-muted">Nenhum ciclo gerado ainda.</Text>}

          {[...cycles].reverse().map((cycle) => {
            const state = cycleState(cycle);
            const { paidCount, open } = cycleTotals(cycle);
            const amount = cycle.charges.filter((charge) => charge.state !== "cancelled").reduce((sum, charge) => sum + charge.amount.amountCents, 0);
            const subtitle =
              state === "cancelled" ? "Cancelada" : state === "done" ? `Todos os ${open} pagaram` : `${paidCount} de ${open} participantes pagos`;

            return (
              <View
                key={cycle.dueDate}
                className={`flex-row items-center justify-between rounded-xl border bg-surface p-3.5 ${state === "open" ? "border-primary/20" : "border-outline/30 opacity-90"}`}
              >
                <View className="flex-1 flex-row items-center gap-3">
                  <View className={`h-9 w-9 items-center justify-center rounded-lg ${state === "done" ? "bg-emerald-50" : state === "open" ? "bg-blue-50" : "bg-surface-muted"}`}>
                    <Image
                      source={state === "done" ? ICONS.check : ICONS.more}
                      tintColor={state === "done" ? "#065f46" : state === "open" ? "#1e40af" : MUTED_TINT}
                      style={{ width: 18, height: 18 }}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-semibold text-ink" numberOfLines={1}>
                      {cycleTitle(billing, cycle)} <Text className="font-medium text-muted">• {dateText(cycle.dueDate)}</Text>
                    </Text>
                    <Text className="text-[11px] text-muted">{subtitle}</Text>
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Text className="text-sm font-semibold text-ink">{money(amount, currency)}</Text>
                  <Tag
                    label={state === "done" ? "Concluída" : state === "open" ? "Em andamento" : "Cancelada"}
                    tone={state === "done" ? "success" : state === "open" ? "info" : "neutral"}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {pending.length > 0 && collecting && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compartilhar link de pagamento"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => (pending.length === 1 ? void shareCharge(pending[0]!) : setChooser(true))}
            className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            <Image source={ICONS.share} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
            <Text className="text-sm font-bold text-white">Compartilhar Link de Pagamento</Text>
          </Pressable>
        )}
      </ScrollView>

      {confirmEnd && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmEnd(false)}>
          <View className="flex-1 items-center justify-center bg-black/40 px-6">
            <View className="w-full max-w-xs gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
              <View className="h-12 w-12 items-center justify-center self-center rounded-full bg-red-100">
                <Image source={ICONS.warning} tintColor="#b91c1c" style={{ width: 22, height: 22 }} />
              </View>
              <Text accessibilityRole="header" className="text-center text-lg font-semibold text-ink">
                Encerrar conta?
              </Text>
              <Text className="text-center text-xs leading-4 text-muted">
                Encerrar cancela as cobranças pendentes de &ldquo;{billing.description}&rdquo; e impede novas ocorrências. Esta ação não pode ser desfeita.
              </Text>
              <View className="flex-row gap-2 pt-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={() => setConfirmEnd(false)}
                  className="h-11 flex-1 items-center justify-center rounded-lg border border-outline"
                >
                  <Text className="text-xs font-semibold text-ink">Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar encerramento"
                  disabled={busy}
                  onPress={() => void transition(billing, BillingState.Ended)}
                  className="h-11 flex-1 items-center justify-center rounded-lg bg-red-600"
                >
                  <Text className="text-xs font-semibold text-white">Encerrar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {chooser && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setChooser(false)}>
          <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setChooser(false)}>
            <View className="gap-2 rounded-t-3xl bg-canvas p-5 pb-10">
              <Text accessibilityRole="header" className="text-lg font-semibold text-primary-strong">
                Compartilhar link de quem?
              </Text>
              {pending.map((charge) => (
                <Pressable
                  key={charge.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Link de ${charge.recipient.name}`}
                  onPress={() => void shareCharge(charge)}
                  className="min-h-14 flex-row items-center gap-3 rounded-2xl border border-outline/40 bg-surface px-4"
                >
                  <InitialsAvatar name={charge.recipient.name} size={36} />
                  <Text className="flex-1 font-semibold text-ink">{charge.recipient.name}</Text>
                  <Text className="text-sm font-semibold text-primary">{formatMoney(charge.amount)}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}

      {notice ? <Toast message={notice} onDismiss={() => setNotice("")} /> : null}
    </SafeAreaView>
  );
}
