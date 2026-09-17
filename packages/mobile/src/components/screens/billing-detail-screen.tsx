import { useCallback, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import {
  billingCategoryLabel,
  BillingKind,
  BillingState,
  calendarDate,
  chargeShareText,
  chargeStateTag,
  formatMoney,
  pendingChargesOf,
  PendingChargesAction,
  SplitPartKind,
  type BillingAllocation,
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
import { ScopeModal } from "@/components/app/scope-modal";
import { Toast } from "@/components/app/toast";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { ActionTile } from "@/components/ui/action-tile";
import { CategoryIcon } from "@/components/ui/category-icon";
import { CopyButton } from "@/components/ui/copy-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { financialClient, type FinancialClient } from "@/financial/client";
import { useThemeColors } from "@/theme/colors";

type Client = Pick<
  FinancialClient,
  | "billing"
  | "patchBilling"
  | "invite"
  | "revokeInvite"
  | "resolveGuest"
  | "publicLink"
  | "publicChargeUrl"
  | "paymentMethods"
  | "pay"
  | "reopen"
  | "reviewProof"
  | "setParticipantNotify"
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

/** The first row of each debtor in the list: the participant action shows there, once per person. */
function firstRowIds(charges: ChargeDetail[]): Set<string> {
  const seen = new Set<string>();
  const ids = new Set<string>();

  for (const charge of charges) {
    if (!charge.debtorId || seen.has(charge.debtorId)) {
      continue;
    }

    seen.add(charge.debtorId);
    ids.add(charge.id);
  }

  return ids;
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
  if (billing.recurrence === "until") {
    const installment = cycle.charges[0]?.installment ?? cycle.index;
    const count = billing.installmentCount ?? cycle.charges[0]?.installmentCount ?? cycle.index;

    return `Parcela ${installment} de ${count}`;
  }

  if (billing.recurrence === "indefinite") {
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

  if (billing.recurrence === "until") {
    const installment = current?.charges[0]?.installment ?? current?.index ?? 1;

    return `Parcelado (${installment}/${billing.installmentCount ?? "?"})${monthEnd}`;
  }

  if (billing.recurrence === "indefinite") {
    return billing.frequency === "yearly" ? "Recorrente anual" : `Recorrente mensal${monthEnd}`;
  }

  return "À vista";
}

/** The one person on the other side of a registro: the contact it pays, or the payer its charges name. */
function counterpartName(billing: BillingDetail): string {
  return billing.contact?.name ?? billing.charges[0]?.recipient.name ?? "";
}

/** "De Ana" on a registro a receber, "Para Ana" on one a pagar. */
function counterpartHeadline(billing: BillingDetail): string {
  return `${billing.type === "payable" ? "Para" : "De"} ${counterpartName(billing)}`;
}

function Tag({ label, tone }: { label: string; tone: "success" | "warning" | "info" | "neutral" | "danger" }) {
  const classes = {
    success: "border-success/30 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    info: "border-info/30 bg-info-soft text-info",
    neutral: "border-outline/30 bg-surface-muted text-muted",
    danger: "border-danger/30 bg-danger-soft text-danger",
  }[tone];

  return <Text className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${classes}`}>{label}</Text>;
}

export function BillingDetailScreen({ id, client = financialClient, onOpenCharge, onEdit }: BillingDetailScreenProps) {
  const colors = useThemeColors();
  const [billing, setBilling] = useState<BillingDetail | null>(null);
  const [invite, setInvite] = useState<BillingInvite | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [scope, setScope] = useState<BillingState.Paused | BillingState.Ended | null>(null);
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

  async function transition(detail: BillingDetail, state: BillingState, pendingCharges?: PendingChargesAction) {
    await run(async () => {
      const updated = await client.patchBilling(detail.id, pendingCharges ? { state, pendingCharges } : { state });

      setBilling(updated);
      setConfirmEnd(false);
      setScope(null);

      // The server keeps the invite alive after the billing ends, so drop it here; a failure must not block the transition.
      if (state === BillingState.Ended && invite) {
        await client.revokeInvite(detail.id).catch(() => undefined);
        setInvite(null);
      }
    }, "Não foi possível atualizar a conta.");
  }

  function pause(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      void transition(detail, BillingState.Paused);
      return;
    }

    setScope(BillingState.Paused);
  }

  function end(detail: BillingDetail) {
    if (!pendingChargesOf(detail).length) {
      setConfirmEnd(true);
      return;
    }

    setScope(BillingState.Ended);
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

  /** "Não notificar" / "Voltar a notificar" for one participant; the answer is the billing with its pending charges updated. */
  async function setParticipantNotify(detail: BillingDetail, userId: string, name: string, notify: boolean) {
    await run(async () => {
      setBilling(await client.setParticipantNotify(detail.id, userId, notify));

      if (!notify) {
        return;
      }

      setNotice(`Avisos reativados para ${name}.`);
    }, "Não foi possível atualizar os avisos.");
  }

  /** Silencing asks first; turning the notices back on does not. */
  function toggleNotify(detail: BillingDetail, participant: BillingAllocation, name: string) {
    const userId = participant.userId;

    if (!userId) {
      return;
    }

    if (!participant.notify) {
      void setParticipantNotify(detail, userId, name, true);
      return;
    }

    Alert.alert(`Não notificar ${name}?`, `Os lembretes automáticos das cobranças pendentes e futuras de ${name} nesta conta param.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Não notificar", onPress: () => void setParticipantNotify(detail, userId, name, false) },
    ]);
  }

  if (!billing) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas" edges={["bottom"]}>
        {error ? (
          <View className="gap-3 px-5">
            <Text accessibilityRole="alert" className="text-center text-danger">
              {error}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={load} className="min-h-12 items-center justify-center">
              <Text className="font-bold text-primary">Tentar novamente</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator accessibilityLabel="Carregando conta" color={colors.primaryStrong} size="large" />
        )}
      </SafeAreaView>
    );
  }

  const today = calendarDate(new Date(), billing.timezone);
  const cycles = cyclesOf(billing);
  const current = currentCycle(cycles);
  const firstRows = firstRowIds(current?.charges ?? []);
  const totals = current ? cycleTotals(current) : { paid: 0, goal: billing.total.amountCents, paidCount: 0, open: 0 };
  const goal = totals.goal || billing.total.amountCents;
  const progress = goal ? Math.min(100, Math.floor((totals.paid / goal) * 100)) : 0;
  const pending = current?.charges.filter((charge) => charge.state === "pending") ?? [];
  const payable = billing.type === "payable";
  // A registro: the owner alone, already settled, with the counterpart typed as free text.
  const settled = billing.kind === BillingKind.Record;
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

  /** The participant behind a row while the billing still splits with them; a conta a pagar has none. */
  function participantOf(detail: BillingDetail, charge: ChargeDetail): BillingAllocation | undefined {
    if (detail.type === "payable") {
      return undefined;
    }

    return detail.allocations.find((allocation) => allocation.kind === SplitPartKind.User && allocation.userId === charge.debtorId);
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-4" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
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
              <Text className="rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-info">{typeTag(billing, current)}</Text>
              {payable && <Text className="rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">A pagar</Text>}
              {settled && <Text className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted">Registro</Text>}
            </View>
            <Tag label={STATE_LABELS[billing.state]} tone={stateTone} />
          </View>

          <Text accessibilityRole="header" className="text-[22px] font-bold tracking-tight text-primary-strong">
            {billing.description}
          </Text>

          {settled && <Text className="text-sm font-semibold text-ink">{counterpartHeadline(billing)}</Text>}

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
              <Image source={ICONS.key} tintColor={colors.primaryStrong} style={{ width: 14, height: 14 }} />
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
                hint={payable ? "Categoria, Pix e lembretes" : billing.recurrence === "indefinite" ? "Valor e pessoas do próximo ciclo" : "Categoria e Pix"}
                disabled={busy}
                onPress={() => onEdit?.(billing)}
              />
              {!payable && !settled && billing.state === "active" && (
                <ActionTile label="Convidar" icon={ICONS.group} hint="Compartilha um convite para entrar na conta" disabled={busy} onPress={() => void inviteSomeone(billing)} />
              )}
              {billing.recurrence === "indefinite" && (
                <ActionTile
                  label={billing.state === "active" ? "Pausar" : "Retomar"}
                  icon={billing.state === "active" ? ICONS.pause : ICONS.play}
                  hint={billing.state === "active" ? "Suspende as próximas ocorrências" : "Volta a gerar ocorrências"}
                  disabled={busy}
                  onPress={() => (billing.state === "active" ? pause(billing) : void transition(billing, BillingState.Active))}
                />
              )}
              <ActionTile label="Encerrar" icon={ICONS.stop} tone="danger" hint="Cancela as pendentes e impede novas ocorrências" disabled={busy} onPress={() => end(billing)} />
            </View>
            {!payable && !settled && invite && billing.state === "active" && (
              <View className="flex-row items-center justify-between px-1">
                <Text className="text-[11px] text-muted">Convite ativo até {dayMonth(invite.expiresAt.slice(0, 10))}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Revogar convite" disabled={busy} onPress={() => void revokeInvite(billing)} className="min-h-8 justify-center">
                  <Text className="text-[11px] font-semibold text-danger">Revogar convite</Text>
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
                      <Text className="text-xs font-semibold text-on-primary">Novo participante</Text>
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
              <Text className="text-lg font-semibold text-primary-strong">{payable || settled ? "Cobranças" : "Participantes"}</Text>
              <Text className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-primary-strong">{current?.charges.length ?? 0}</Text>
            </View>
            {current && billing.recurrence !== "once" && (
              <Text className="text-[11px] text-muted">
                {billing.recurrence === "until" ? `Ciclo ${current.charges[0]?.installment ?? current.index} de ${billing.installmentCount ?? "?"}` : `Ciclo ${current.index}`}
              </Text>
            )}
          </View>

          {!current && <Text className="text-sm text-muted">Nenhuma cobrança gerada ainda.</Text>}

          {current?.charges.map((charge) => {
            const status = statusLine(charge);
            const isPending = charge.state === "pending";
            // A file under review changes what the row asks of the owner: review it, never nag.
            const reviewing = isPending && charge.proofState === "pending";
            const statusColor = { success: "text-primary", warning: "text-warning", danger: "text-danger", neutral: "text-muted" }[status.tone];
            // The corner tag's own urgency wording matches the feed's badges; only "Em revisão" overrides it.
            const tag = reviewing ? { label: "Em revisão", tone: "info" as const } : chargeStateTag(charge, today);
            // A registro's rows carry its counterpart; a conta a pagar names the contact who receives.
            const name = payable && !settled ? (billing.contact?.name ?? "Só comigo") : charge.recipient.name;
            const avatar = payable && !settled ? (billing.contact?.avatar ?? null) : charge.recipient.avatar;
            const participant = participantOf(billing, charge);
            // The badge is this charge's own switch; the participant's switch drives their action.
            const quiet = charge.notify === false;
            const participantQuiet = participant?.notify === false;

            return (
              <View
                key={charge.id}
                className={`gap-2.5 rounded-xl border border-outline/30 bg-surface p-3.5 ${isPending ? "border-l-4 border-l-warning" : ""}`}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir cobrança de ${name}`}
                  onPress={() => onOpenCharge?.(charge.id)}
                  className="flex-row items-center justify-between gap-3"
                >
                  <View className="flex-1 flex-row items-center gap-3">
                    <InitialsAvatar name={name} size={40} avatar={avatar} />
                    <View className="flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Text className="shrink text-sm font-semibold text-ink" numberOfLines={1}>
                          {name}
                        </Text>
                        {quiet && <Tag label="Sem avisos" tone="neutral" />}
                      </View>
                      <Text className={`text-[11px] font-medium ${statusColor}`}>{status.text}</Text>
                    </View>
                  </View>
                  <View className="items-end gap-1">
                    <Text className="text-sm font-semibold text-ink">{formatMoney(charge.amount)}</Text>
                    <Tag label={tag.label} tone={tag.tone} />
                  </View>
                </Pressable>

                {reviewing && (
                  <View className="flex-row items-center justify-between border-t border-outline/20 pt-2.5">
                    <View className="flex-row items-center gap-1">
                      <Image source={ICONS.receipt} tintColor={colors.primaryStrong} style={{ width: 13, height: 13 }} />
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
                        <Text className="text-[11px] font-semibold text-on-primary">Revisar</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                {isPending && !reviewing && collecting && (
                  <View className="flex-row items-center justify-between border-t border-outline/20 pt-2.5">
                    <View className="flex-row items-center gap-1">
                      <Image source={ICONS.bell} tintColor={colors.warning} style={{ width: 13, height: 13 }} />
                      <Text className="text-[11px] font-medium text-warning">Aguardando pagamento</Text>
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
                      {!settled && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Compartilhar link de ${name}`}
                          accessibilityState={{ disabled: busy }}
                          disabled={busy}
                          onPress={() => void shareCharge(charge)}
                          className={`h-8 w-8 items-center justify-center rounded-lg bg-primary ${busy ? "opacity-50" : ""}`}
                        >
                          <Image source={ICONS.share} tintColor={colors.onPrimary} style={{ width: 14, height: 14 }} />
                        </Pressable>
                      )}
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

                {participant && !ended && firstRows.has(charge.id) && (
                  <View className="flex-row items-center justify-end border-t border-outline/20 pt-2.5">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={participantQuiet ? `Voltar a notificar ${name}` : `Não notificar ${name}`}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={() => toggleNotify(billing, participant, name)}
                      className={`min-h-8 justify-center px-1 ${busy ? "opacity-50" : ""}`}
                    >
                      <Text className="text-[11px] font-semibold text-muted">{participantQuiet ? "Voltar a notificar" : "Não notificar"}</Text>
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

          {billing.recurrence === "indefinite" &&
            billing.previews.map((preview) => (
              <View key={preview.occurrenceDate} className="flex-row items-center justify-between rounded-xl border border-dashed border-outline/40 bg-surface/70 p-3.5">
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-lg bg-surface-muted">
                    <Image source={ICONS.more} tintColor={colors.muted} style={{ width: 18, height: 18 }} />
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
                  <View className={`h-9 w-9 items-center justify-center rounded-lg ${state === "done" ? "bg-success-soft" : state === "open" ? "bg-info-soft" : "bg-surface-muted"}`}>
                    <Image
                      source={state === "done" ? ICONS.check : ICONS.more}
                      tintColor={state === "done" ? colors.success : state === "open" ? colors.info : colors.muted}
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

        {pending.length > 0 && collecting && !settled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compartilhar link de pagamento"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => (pending.length === 1 ? void shareCharge(pending[0]!) : setChooser(true))}
            className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            <Image source={ICONS.share} tintColor={colors.onPrimary} style={{ width: 18, height: 18 }} />
            <Text className="text-sm font-bold text-on-primary">Compartilhar Link de Pagamento</Text>
          </Pressable>
        )}
      </ScrollView>

      {confirmEnd && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmEnd(false)}>
          <View className="flex-1 items-center justify-center bg-scrim px-6">
            <View className="w-full max-w-xs gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
              <View className="h-12 w-12 items-center justify-center self-center rounded-full bg-danger-soft">
                <Image source={ICONS.warning} tintColor={colors.danger} style={{ width: 22, height: 22 }} />
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
                  className="h-11 flex-1 items-center justify-center rounded-lg bg-danger-solid"
                >
                  <Text className="text-xs font-semibold text-on-danger">Encerrar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {scope && (
        <ScopeModal
          title={scope === BillingState.Paused ? "Pausar conta?" : "Encerrar conta?"}
          subtitle={scope === BillingState.Ended ? "Esta ação não pode ser desfeita." : undefined}
          explanation={
            scope === BillingState.Paused
              ? `Novas cobranças deixam de ser geradas. E as pendentes de “${billing.description}”?`
              : `Encerrar impede novas ocorrências de “${billing.description}”. E as pendentes?`
          }
          primaryLabel="Manter as deste mês"
          secondaryLabel={`Cancelar pendentes (${pendingChargesOf(billing).length})`}
          secondaryTone="danger"
          busy={busy}
          onPrimary={() => void transition(billing, scope, PendingChargesAction.Keep)}
          onSecondary={() => void transition(billing, scope, PendingChargesAction.Cancel)}
          onCancel={() => setScope(null)}
        />
      )}

      {chooser && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setChooser(false)}>
          <Pressable className="flex-1 justify-end bg-scrim" onPress={() => setChooser(false)}>
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
                  <InitialsAvatar name={charge.recipient.name} size={36} avatar={charge.recipient.avatar} />
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
