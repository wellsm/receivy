import { useCallback, useState } from "react";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { calendarDate, formatMoney, formatPhoneBR, initialsOf, type ChargeDetail, type Contact, type ContactLedger } from "@receivy/common";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { ActionTile } from "@/components/ui/action-tile";
import { financialClient, type FinancialClient } from "@/financial/client";
import { notificationClient } from "@/notifications/client";
import { contactsClient } from "@/contacts/client";
import { useThemeColors } from "@/theme/colors";

type Client = Pick<FinancialClient, "ledger" | "publicLink" | "publicChargeUrl">;

type ContactLedgerScreenProps = {
  id: string;
  client?: Client;
  contacts?: Pick<typeof contactsClient, "archive">;
  notifications?: Pick<typeof notificationClient, "remind">;
  onOpenCharge?: (id: string) => void;
  /** Hands the contact over because a billing draft seats people by their user id, not by the agenda entry. */
  onNewCharge?: (contact: Contact) => void;
  /** Absent when the screen cannot navigate to the contact form. */
  onEdit?: () => void;
};

const LEDGER_ERROR = "Não foi possível carregar o histórico.";
const ARCHIVE_ERROR = "Não foi possível remover o contato.";

const ICONS = {
  phone: require("../../../assets/images/auth/phone.svg"),
  mail: require("../../../assets/images/auth/mail.svg"),
  edit: require("../../../assets/images/auth/edit.svg"),
  plus: require("../../../assets/images/auth/plus.svg"),
  trash: require("../../../assets/images/auth/trash.svg"),
  share: require("../../../assets/images/auth/share.svg"),
  bell: require("../../../assets/images/auth/bell.svg"),
  check: require("../../../assets/images/auth/check.svg"),
  key: require("../../../assets/images/auth/key.svg"),
} as const;

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function dueLabel(charge: ChargeDetail, today: string): { text: string; late: boolean } {
  const days = daysBetween(today, charge.dueDate);

  if (days < 0) {
    return { text: `Atrasada há ${-days} dia${days === -1 ? "" : "s"}`, late: true };
  }

  if (days === 0) {
    return { text: "Vence hoje", late: false };
  }

  return { text: days === 1 ? "Vence amanhã" : `Vence em ${days} dias`, late: false };
}

function scheduleLine(charge: ChargeDetail): string {
  const due = `Vencimento em ${dateText(charge.dueDate)}`;

  if (charge.installmentCount && charge.installmentCount > 1) {
    return `Parcela ${charge.installment} de ${charge.installmentCount} • ${due}`;
  }

  return due;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function Tag({ label, tone }: { label: string; tone: "success" | "warning" | "info" | "neutral" | "danger" }) {
  const classes = {
    success: "border-success/30 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    info: "border-info/30 bg-info-soft text-info",
    neutral: "border-outline/30 bg-surface-muted text-muted",
    danger: "border-danger/30 bg-danger-soft text-danger",
  }[tone];

  return <Text className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes}`}>{label}</Text>;
}

export function ContactLedgerScreen({
  id,
  client = financialClient,
  contacts = contactsClient,
  notifications = notificationClient,
  onOpenCharge,
  onNewCharge,
  onEdit,
}: ContactLedgerScreenProps) {
  const colors = useThemeColors();
  const [data, setData] = useState<ContactLedger | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);

      try {
        const page = await client.ledger(id, cursor);

        setData((old) => (cursor && old ? { ...page, charges: [...old.charges, ...page.charges] } : page));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : LEDGER_ERROR);
      } finally {
        setLoading(false);
      }
    },
    [client, id],
  );

  // The edit form leaves this screen mounted under the Stack, so the pop back has
  // to reload: otherwise the detail keeps showing the data the form just replaced.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  async function archive() {
    const done = await run(async () => {
      await contacts.archive(id);
      await load();
      return true;
    }, ARCHIVE_ERROR);

    setConfirmRemoval(false);

    if (done) {
      setNotice("Contato removido; o histórico fica preservado.");
    }
  }

  async function shareLink(charge: ChargeDetail) {
    await run(async () => {
      const link = await client.publicLink(charge.id);
      const url = client.publicChargeUrl(link.token);

      await Share.share({ title: "Cobrança Receivy", message: url, url });
    }, "Não foi possível compartilhar o link.");
  }

  async function remind(charge: ChargeDetail) {
    const result = await run(() => notifications.remind(charge.id), "Não foi possível enviar o lembrete.");

    if (result) {
      setNotice(result.queued ? "Lembrete enviado." : "Este contato ainda não recebe lembretes.");
    }
  }

  if (!data) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas" edges={["bottom"]}>
        {error ? (
          <View className="gap-3 px-5">
            <Text accessibilityRole="alert" className="text-center text-danger">
              {error}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={() => void load()} className="min-h-12 items-center justify-center">
              <Text className="font-bold text-primary">Tentar novamente</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator accessibilityLabel="Carregando histórico" color={colors.primaryStrong} size="large" />
        )}
      </SafeAreaView>
    );
  }

  const { contact } = data;
  const today = calendarDate();
  const archived = Boolean(contact.archivedAt);
  const active = data.charges.filter((charge) => charge.state === "pending");
  const history = data.charges.filter((charge) => charge.state !== "pending");
  const settled = history.filter((charge) => charge.state === "paid" && charge.direction === "receivable");
  const settledCents = settled.reduce((sum, charge) => sum + charge.amount.amountCents, 0);
  const activeCents = active.reduce((sum, charge) => sum + (charge.direction === "receivable" ? charge.amount.amountCents : 0), 0);
  const pendingCount = active.filter((charge) => charge.direction === "receivable").length;
  const first = firstName(contact.displayName);
  const currency = data.receivable.currency;

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-2" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="rounded-xl bg-primary-soft/40 p-3 text-sm text-primary-strong">
            {notice}
          </Text>
        ) : null}

        {/* Perfil */}
        <View className="items-center overflow-hidden rounded-xl border border-outline/30 bg-surface p-5">
          <View className="absolute left-0 right-0 top-0 h-1.5 bg-primary" />
          <View className="mb-3 h-20 w-20 items-center justify-center rounded-full border-2 border-surface bg-primary-soft/60">
            <Text className="text-[22px] font-bold text-primary-strong">{initialsOf(contact.displayName)}</Text>
          </View>
          <Text accessibilityRole="header" className="text-[22px] font-bold text-ink">
            {contact.displayName}
          </Text>
          {contact.nickname ? <Text className="text-xs text-muted">{contact.name}</Text> : null}
          <View className="mt-1 items-center gap-0.5">
            {contact.phone ? (
              <View className="flex-row items-center gap-1.5">
                <Image source={ICONS.phone} tintColor={colors.primaryStrong} style={{ width: 15, height: 15 }} />
                <Text className="text-xs font-semibold text-ink">{formatPhoneBR(contact.phone)}</Text>
              </View>
            ) : null}
            <View className="flex-row items-center gap-1.5">
              <Image source={ICONS.mail} tintColor={colors.muted} style={{ width: 15, height: 15 }} />
              <Text className="text-xs text-muted">{contact.email || "Só por link"}</Text>
            </View>
          </View>
          <View className="mt-3.5 flex-row items-center gap-2">
            {contact.status === "pending" && !archived ? <Tag label="Ainda não entrou" tone="neutral" /> : null}
            {archived ? (
              <Tag label="Contato removido" tone="neutral" />
            ) : active.length ? (
              <View className="flex-row items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1">
                <View className="h-2 w-2 rounded-full bg-warning" />
                <Text className="text-xs font-semibold text-warning">
                  {active.length} cobrança{active.length === 1 ? "" : "s"} ativa{active.length === 1 ? "" : "s"}
                </Text>
              </View>
            ) : (
              <Tag label="Sem cobranças ativas" tone="neutral" />
            )}
          </View>
        </View>

        {/* Ações rápidas */}
        {!archived && (
          <View className="flex-row gap-2">
            {onEdit && <ActionTile label="Editar" icon={ICONS.edit} hint="Abre o formulário do contato" disabled={busy} onPress={onEdit} />}
            {onNewCharge && <ActionTile label="Cobrar" icon={ICONS.plus} tone="primary" hint={`Nova conta para ${first}`} disabled={busy} onPress={() => onNewCharge(contact)} />}
            <ActionTile label="Remover" icon={ICONS.trash} tone="danger" hint="Arquiva o contato e preserva o histórico" disabled={busy} onPress={() => setConfirmRemoval(true)} />
          </View>
        )}

        {/* Balanço */}
        <View className="gap-3 rounded-xl border border-outline/30 bg-surface p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-bold text-ink">Balanço com {first}</Text>
            <Text className="text-[11px] text-muted">
              {data.charges.length} cobrança{data.charges.length === 1 ? "" : "s"} no total
            </Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 gap-1 rounded-lg border border-outline/20 bg-surface-muted/80 p-3">
              <Text className="text-[11px] text-muted">A receber</Text>
              <Text className="text-2xl font-extrabold text-primary">{formatMoney(data.receivable)}</Text>
              <Text className="text-[11px] text-warning">
                {pendingCount} pendência{pendingCount === 1 ? "" : "s"}
              </Text>
            </View>
            <View className="flex-1 gap-1 rounded-lg border border-outline/20 bg-surface-muted/80 p-3">
              <Text className="text-[11px] text-muted">Já liquidado</Text>
              <Text className="text-2xl font-extrabold text-ink">{formatMoney({ amountCents: settledCents, currency })}</Text>
              <Text className="text-[11px] text-primary">
                {settled.length} quitada{settled.length === 1 ? "" : "s"}
              </Text>
            </View>
          </View>
          {data.payable.amountCents > 0 && (
            <Text className="text-xs text-muted">
              Você deve <Text className="font-bold text-ink">{formatMoney(data.payable)}</Text> para {first}.
            </Text>
          )}
        </View>

        {/* Cobranças ativas */}
        <View className="gap-2.5">
          <View className="flex-row items-center justify-between px-0.5">
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-bold text-ink">Cobranças Ativas</Text>
              <View className="h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1">
                <Text className="text-[11px] font-bold text-on-primary">{active.length}</Text>
              </View>
            </View>
            <Text className="text-[11px] text-muted">Total: {formatMoney({ amountCents: activeCents, currency })}</Text>
          </View>

          {!active.length && <Text className="text-sm text-muted">Nada pendente com {first}.</Text>}

          {active.map((charge) => {
            const due = dueLabel(charge, today);
            const waitingProof = charge.proofState === "pending";
            const receivable = charge.direction === "receivable";

            return (
              <View key={charge.id} className={`gap-3 rounded-xl border border-outline/30 bg-surface p-4 ${due.late ? "border-l-4 border-l-danger" : receivable ? "border-l-4 border-l-warning" : ""}`}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Abrir cobrança ${charge.description}`} onPress={() => onOpenCharge?.(charge.id)} className="flex-row items-start justify-between gap-2">
                  <View className="flex-1 gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-base font-bold text-ink">{charge.description}</Text>
                      {waitingProof ? (
                        <Tag label="Aguardando comprovante" tone="info" />
                      ) : receivable ? (
                        <Tag label="Pendente" tone="warning" />
                      ) : (
                        <Tag label="A pagar" tone="neutral" />
                      )}
                    </View>
                    <Text className="text-xs text-muted">{scheduleLine(charge)}</Text>
                  </View>
                  <Text className="text-lg font-bold text-ink">{formatMoney(charge.amount)}</Text>
                </Pressable>

                <View className="flex-row items-center justify-between gap-2 border-t border-outline/20 pt-3">
                  <Text className={`rounded px-2 py-0.5 text-[11px] font-medium ${due.late ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>{due.text}</Text>
                  {receivable && (
                    <View className="flex-row items-center gap-2">
                      {charge.sharingState === "ready" && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Link de ${charge.description}`}
                          disabled={busy}
                          onPress={() => void shareLink(charge)}
                          className="h-9 flex-row items-center gap-1 rounded-lg bg-surface-muted px-3"
                        >
                          <Image source={ICONS.share} tintColor={colors.primaryStrong} style={{ width: 14, height: 14 }} />
                          <Text className="text-xs font-semibold text-ink">Link</Text>
                        </Pressable>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Lembrar ${charge.description}`}
                        disabled={busy}
                        onPress={() => void remind(charge)}
                        className="h-9 flex-row items-center gap-1.5 rounded-lg bg-primary px-3.5"
                      >
                        <Image source={ICONS.bell} tintColor={colors.onPrimary} style={{ width: 14, height: 14 }} />
                        <Text className="text-xs font-semibold text-on-primary">Lembrar Pix</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Histórico */}
        <View className="gap-2.5">
          <View className="flex-row items-center justify-between px-0.5">
            <Text className="text-lg font-bold text-ink">Histórico / Concluídas</Text>
            <Text className="text-[11px] font-semibold text-primary">
              {settled.length} liquidada{settled.length === 1 ? "" : "s"}
            </Text>
          </View>

          {!history.length && <Text className="text-sm text-muted">Nenhuma cobrança concluída ainda.</Text>}

          {history.map((charge) => {
            const paid = charge.state === "paid";

            return (
              <Pressable
                key={charge.id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir cobrança ${charge.description}`}
                onPress={() => onOpenCharge?.(charge.id)}
                className="flex-row items-center justify-between gap-3 rounded-xl border border-outline/20 bg-surface p-4"
              >
                <View className="flex-1 flex-row items-center gap-3">
                  <View className={`h-9 w-9 items-center justify-center rounded-full ${paid ? "bg-success-soft" : "bg-surface-muted"}`}>
                    <Image source={paid ? ICONS.check : ICONS.trash} tintColor={paid ? colors.success : colors.muted} style={{ width: 18, height: 18 }} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-ink" numberOfLines={1}>
                      {charge.description}
                    </Text>
                    <Text className="text-xs text-muted">
                      {paid ? `Pago em ${dateText((charge.paidAt ?? charge.dueDate).slice(0, 10))}` : "Cancelada"}
                    </Text>
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Text className="text-base font-bold text-ink">{formatMoney(charge.amount)}</Text>
                  <Text className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${paid ? "bg-success-soft text-success" : "bg-surface-muted text-muted"}`}>
                    {paid ? "Pago" : "Cancelada"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {loading && <ActivityIndicator accessibilityLabel="Carregando histórico" color={colors.primaryStrong} />}
        {data.nextCursor && (
          <Pressable accessibilityRole="button" accessibilityLabel="Carregar mais" onPress={() => void load(data.nextCursor ?? undefined)} className="min-h-12 items-center justify-center">
            <Text className="font-bold text-primary">Carregar mais</Text>
          </Pressable>
        )}
      </ScrollView>


      {confirmRemoval && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setConfirmRemoval(false)}>
          <View className="flex-1 items-center justify-center bg-scrim px-4">
            <View className="w-full max-w-sm gap-4 rounded-2xl border border-outline/30 bg-surface p-5">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
                  <Image source={ICONS.trash} tintColor={colors.danger} style={{ width: 22, height: 22 }} />
                </View>
                <View className="flex-1">
                  <Text accessibilityRole="header" className="text-[17px] font-bold text-ink">
                    Remover contato?
                  </Text>
                  <Text className="text-[11px] text-muted">O histórico de cobranças fica preservado.</Text>
                </View>
              </View>
              <Text className="text-xs leading-5 text-muted">{contact.displayName} sai da sua agenda e não entra em novas cobranças.</Text>
              <View className="flex-row gap-2.5 pt-1">
                <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" onPress={() => setConfirmRemoval(false)} className="h-11 flex-1 items-center justify-center rounded-xl border border-outline/50">
                  <Text className="text-sm font-semibold text-ink">Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirmar remoção"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void archive()}
                  className="h-11 flex-1 items-center justify-center rounded-xl bg-danger-solid"
                >
                  <Text className="text-sm font-semibold text-on-danger">Remover</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}
