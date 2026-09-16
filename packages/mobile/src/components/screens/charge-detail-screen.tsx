import { useCallback, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import {
  calendarDate,
  canAcceptProof,
  canCancelCharge,
  canMarkPaid,
  canRemind,
  canReopenCharge,
  canShare,
  canSilenceCharge,
  canUploadProof,
  chargeDateText,
  chargeStateTag,
  chargeShareText,
  chargeStatusLine,
  chargeTypeLabel,
  ChargeTone,
  counterpartRoleLabel,
  formatMoney,
  ProofKind,
  type ChargeDetail,
} from "@receivy/common";
import { FirstSharePix } from "@/components/app/first-share-pix";
import { ProofCard } from "@/components/app/proof-card";
import { RejectReasonSheet } from "@/components/app/reject-reason-sheet";
import { Toast } from "@/components/app/toast";
import { ActionTile } from "@/components/ui/action-tile";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { StatusTag } from "@/components/ui/status-tag";
import { financialClient, type FinancialClient } from "@/financial/client";
import { pickAndUploadProof } from "@/financial/proof-upload";
import { notificationClient } from "@/notifications/client";
import { useThemeColors } from "@/theme/colors";

export type ProofClient = Pick<FinancialClient, "startProofUpload" | "completeProofUpload" | "reviewProof" | "downloadProof" | "withdrawProof">;

type Client = Pick<FinancialClient, "charge" | "cancel" | "pay" | "publicLink" | "publicChargeUrl"> &
  Partial<ProofClient & Pick<FinancialClient, "reopen" | "paymentMethods" | "savePaymentMethod" | "declarePayment" | "setChargeNotify">>;

type ChargeDetailScreenProps = {
  id: string;
  client?: Client;
  notifications?: Pick<typeof notificationClient, "remind">;
  /** Opens the proof viewer; also used as the preview right after the debtor sends a file. */
  onOpenProof?: () => void;
};

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

const ICONS = {
  check: require("../../../assets/images/auth/check.svg"),
  share: require("../../../assets/images/auth/share.svg"),
  bell: require("../../../assets/images/auth/bell.svg"),
  stop: require("../../../assets/images/auth/stop.svg"),
  edit: require("../../../assets/images/auth/edit.svg"),
  copy: require("../../../assets/images/auth/copy.svg"),
  receipt: require("../../../assets/images/auth/receipt.svg"),
  upload: require("../../../assets/images/auth/upload.svg"),
  eye: require("../../../assets/images/auth/eye.svg"),
  key: require("../../../assets/images/auth/key.svg"),
  calendar: require("../../../assets/images/auth/calendar.svg"),
} as const;

const STATUS_COLOR = {
  success: "text-primary",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-muted",
  info: "text-info",
} as const;

/** What a debtor sees instead of actions once the charge no longer accepts a payment. */
function payableGuidance(charge: ChargeDetail): string | null {
  if (charge.direction !== "payable") {
    return null;
  }

  if (charge.state === "paid") {
    return "Esta cobrança já foi paga. Nenhuma nova transferência é necessária.";
  }

  if (charge.state === "cancelled") {
    return "Esta cobrança foi cancelada e não deve ser paga.";
  }

  // The owner of a conta a pagar knows where to pay; the note only helps a debtor waiting on a key.
  if (charge.pix || charge.ownedByViewer) {
    return null;
  }

  return "A chave Pix ainda não está disponível. Combine o pagamento com o credor.";
}

export function ChargeDetailScreen({ id, client = financialClient, notifications = notificationClient, onOpenProof }: ChargeDetailScreenProps) {
  const colors = useThemeColors();
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(() => {
    let live = true;

    client
      .charge(id)
      .then((detail) => {
        if (!live) {
          return;
        }

        setCharge(detail);
        setError("");
      })
      .catch((reason: unknown) => live && setError(reason instanceof Error ? reason.message : LOAD_ERROR));

    return () => {
      live = false;
    };
  }, [client, id]);

  // The proof viewer sits on top of this route, so every return refreshes the state.
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

  async function markPaid(acceptProof: boolean) {
    await run(async () => {
      if (acceptProof && client.reviewProof) {
        setCharge(await client.reviewProof(id, "accepted"));
        setNotice("Comprovante aceito e pagamento registrado.");
        return;
      }

      setCharge(await client.pay(id));
      setNotice("Pagamento integral registrado.");
    }, "Não foi possível atualizar a cobrança.");
  }

  function confirmPaid(acceptProof: boolean) {
    Alert.alert("Marcar como paga?", "Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois.", [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar paga", onPress: () => void markPaid(acceptProof) },
    ]);
  }

  function confirmDeclare(detail: ChargeDetail) {
    Alert.alert("Informar pagamento?", `${detail.counterpartName} vai receber um aviso para confirmar o recebimento.`, [
      { text: "Voltar", style: "cancel" },
      { text: "Já paguei", onPress: () => void declare() },
    ]);
  }

  async function declare() {
    if (!client.declarePayment) {
      return;
    }

    const detail = await run(() => client.declarePayment!(id), "Não foi possível informar o pagamento.");

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice("Pagamento informado. Aguarde a confirmação.");
  }

  async function rejectDeclaration(reason: string) {
    if (!client.reviewProof) {
      return;
    }

    const detail = await run(() => client.reviewProof!(id, "rejected", reason || undefined), "Não foi possível responder.");

    setRejecting(false);

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice("Resposta enviada.");
  }

  function confirmReopen() {
    if (!client.reopen) {
      return;
    }

    Alert.alert("Reabrir cobrança?", "O pagamento registrado é removido e a cobrança volta a ficar pendente. Um comprovante aceito volta para revisão.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Reabrir",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            setCharge(await client.reopen!(id));
          }, "Não foi possível reabrir a cobrança."),
      },
    ]);
  }

  function confirmCancel() {
    Alert.alert("Cancelar cobrança?", "Ela não aceitará pagamento e continuará no histórico.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Cancelar cobrança",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            setCharge(await client.cancel(id));
            setNotice("Cobrança cancelada e mantida no histórico.");
          }, "Não foi possível atualizar a cobrança."),
      },
    ]);
  }

  async function shareLink(rotate = false, paymentMethodId?: string) {
    await run(async () => {
      const result = await client.publicLink(id, rotate, paymentMethodId);
      const detail = paymentMethodId ? await client.charge(id) : charge;

      if (!detail) {
        return;
      }

      setCharge(detail);

      const url = client.publicChargeUrl(result.token);

      await Share.share({ title: "Cobrança Receivy", message: chargeShareText(detail, url), url });
    }, "Não foi possível compartilhar o link.");
  }

  function confirmRemind(detail: ChargeDetail) {
    Alert.alert(
      "Enviar lembrete?",
      `Avisa ${detail.recipient.name} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`,
      [
        { text: "Voltar", style: "cancel" },
        { text: "Enviar lembrete", onPress: () => void remind(detail) },
      ],
    );
  }

  async function remind(detail: ChargeDetail) {
    const result = await run(() => notifications.remind(detail.id), "Não foi possível enviar o lembrete.");

    if (result) {
      setNotice(result.queued ? `Lembrete enviado para ${detail.recipient.name}.` : `${detail.recipient.name} ainda não recebe lembretes.`);
    }
  }

  async function copyPix(key: string) {
    let done = false;

    try {
      done = await Clipboard.setStringAsync(key);
    } catch {
      done = false;
    }

    if (!done) {
      setError("Não foi possível copiar a chave.");
      return;
    }

    setError("");
    setNotice("Chave Pix copiada.");
  }

  async function uploadProof() {
    if (!client.startProofUpload) {
      return;
    }

    const detail = await run(() => pickAndUploadProof(id, client as Client & ProofClient), "Não foi possível enviar o comprovante.");

    if (!detail) {
      return;
    }

    setCharge(detail);
    onOpenProof?.();
  }

  async function withdrawProof() {
    if (!client.withdrawProof) {
      return;
    }

    const wasDeclaration = charge?.proof?.kind === ProofKind.Declaration;

    const done = await run(async () => {
      await client.withdrawProof!(id);
      return true;
    }, "Não foi possível apagar o comprovante.");

    if (!done) {
      return;
    }

    setCharge((previous) => previous && { ...previous, proof: null, proofState: null });
    setNotice(wasDeclaration ? "Pagamento informado desfeito." : "Comprovante apagado. Envie outro quando quiser.");
  }

  async function setNotify(notify: boolean) {
    const setChargeNotify = client.setChargeNotify;

    if (!setChargeNotify) {
      return;
    }

    const detail = await run(() => setChargeNotify(id, notify), "Não foi possível atualizar os avisos.");

    if (!detail) {
      return;
    }

    setCharge(detail);
    setNotice(notify ? "Avisos reativados." : "Avisos desta cobrança pausados.");
  }

  if (!charge) {
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
          <ActivityIndicator accessibilityLabel="Carregando cobrança" color={colors.primaryStrong} size="large" />
        )}
      </SafeAreaView>
    );
  }

  const receivable = charge.direction === "receivable";
  const pending = charge.state === "pending";
  const proof = charge.proof;
  const today = calendarDate();
  const state = chargeStateTag(charge, today);
  const status = chargeStatusLine(charge, today);
  const guidance = payableGuidance(charge);
  const ownBill = charge.payer === "owner" && charge.ownedByViewer === true;
  // Who could publish a link once a key exists: the creditor of a conta a receber with contacts, never a registro.
  const sharer = receivable && pending && charge.payer !== "owner" && !charge.settled;
  const settleable = canMarkPaid(charge);
  const reopenable = !!client.reopen && canReopenCharge(charge);
  const share = canShare(charge);
  const remindable = canRemind(charge);
  const cancellable = canCancelCharge(charge);
  const quiet = charge.notify === false;
  const silenceable = !!client.setChargeNotify && canSilenceCharge(charge);
  const acceptProof = canAcceptProof(charge);
  const uploadProofAllowed = canUploadProof(charge);
  const proofsEnabled = !!client.startProofUpload;
  const viewable = proof?.kind === ProofKind.File;
  // A debtor sends the proof; the payee of a conta a pagar only reviews the one the owner sent.
  const proofTile = proofsEnabled && !charge.settled && (!receivable || (charge.payer === "owner" && viewable));
  const name = charge.counterpartName || charge.recipient.name;

  // The sticky footer either sends a file or opens the one already sent; a declaration has nothing to view.
  let footerLabel = "Ver comprovante enviado";
  let footerIcon = ICONS.eye;

  if (uploadProofAllowed) {
    footerLabel = viewable ? "Enviar novo comprovante" : "Enviar comprovante";
    footerIcon = ICONS.upload;
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-6 pt-4" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </Text>
        ) : null}

        {/* Hero: the same card the billing detail opens with, scoped to one person */}
        <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${receivable ? "bg-primary-soft/50 text-primary-strong" : "bg-danger-soft text-danger"}`}>
                {receivable ? "A receber" : "A pagar"}
              </Text>
              <Text className="rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-info">{chargeTypeLabel(charge)}</Text>
              {ownBill && <Text className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-muted">Minha conta</Text>}
            </View>
            <View className="flex-row items-center gap-1.5">
              {charge.settled && <StatusTag label="Registro" tone={ChargeTone.Neutral} compact />}
              {quiet && <StatusTag label="Sem avisos" tone={ChargeTone.Neutral} compact />}
              <StatusTag label={state.label} tone={state.tone} compact />
            </View>
          </View>

          <Text accessibilityRole="header" className="text-[22px] font-bold tracking-tight text-primary-strong">
            {charge.description}
          </Text>

          <View className="flex-row items-center gap-3">
            <InitialsAvatar
              name={name}
              size={40}
              avatar={charge.counterpartAvatar ?? (charge.ownedByViewer && !charge.debtorUserId ? charge.recipient.avatar : null)}
            />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                {name}
              </Text>
              <Text className="text-[11px] text-muted">{counterpartRoleLabel(charge)}</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-1.5">
            <Image source={ICONS.calendar} tintColor={colors.primaryStrong} style={{ width: 14, height: 14 }} />
            <Text className="text-xs text-muted">
              Vencimento: <Text className="font-semibold text-ink">{chargeDateText(charge.dueDate)}</Text>
              {pending && <Text className={STATUS_COLOR[status.tone]}> ({status.text.toLocaleLowerCase("pt-BR")})</Text>}
            </Text>
          </View>

        </View>

        {/* Amount */}
        <View className="items-center gap-1 rounded-2xl border border-outline/30 bg-surface p-5">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted">{receivable ? "Valor a receber" : "Valor a pagar"}</Text>
          <Text className="text-4xl font-extrabold tracking-tight text-primary-strong">{formatMoney(charge.amount)}</Text>
          <Text className={`text-xs font-medium ${STATUS_COLOR[status.tone]}`}>{status.text}</Text>
        </View>

        {/* Quick actions: the shared helpers decide what each viewer may do */}
        {(pending || reopenable) && (
          <View className="gap-2.5">
            <View className="flex-row gap-2">
              {reopenable && <ActionTile label="Reabrir" icon={ICONS.edit} hint="Desfaz o pagamento e volta a cobrança para pendente" disabled={busy} onPress={confirmReopen} />}
              {charge.settled && settleable && <ActionTile label="Marcar como pago" icon={ICONS.check} tone="primary" disabled={busy} onPress={() => confirmPaid(false)} />}
              {!receivable && charge.pix && (
                <ActionTile
                  label="Copiar Chave Pix"
                  icon={ICONS.copy}
                  hint={ownBill ? "Copia a chave Pix da conta" : "Copia a chave Pix do credor"}
                  disabled={busy}
                  onPress={() => void copyPix(charge.pix!.key)}
                />
              )}
              {proofTile && (
                <ActionTile
                  label={viewable ? "Comprovante" : "Enviar comprovante"}
                  icon={viewable ? ICONS.eye : ICONS.upload}
                  tone={settleable ? "neutral" : "primary"}
                  hint={viewable ? "Abre o comprovante enviado" : "Envia o comprovante de pagamento"}
                  disabled={busy}
                  onPress={() => (viewable ? onOpenProof?.() : void uploadProof())}
                />
              )}
              {share && <ActionTile label="Compartilhar" icon={ICONS.share} hint="Envia o link público de pagamento" disabled={busy} onPress={() => void shareLink()} />}
              {remindable && <ActionTile label="Lembrar" icon={ICONS.bell} hint="Envia um lembrete de pagamento" disabled={busy} onPress={() => confirmRemind(charge)} />}
              {cancellable && <ActionTile label="Cancelar" icon={ICONS.stop} tone="danger" hint="Encerra a cobrança sem pagamento" disabled={busy} onPress={confirmCancel} />}
            </View>
            {share && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Trocar e compartilhar link"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void shareLink(true)}
                className="min-h-8 items-end justify-center px-1"
              >
                <Text className="text-[11px] font-semibold text-primary">Trocar e compartilhar link</Text>
              </Pressable>
            )}
            {silenceable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={quiet ? "Voltar a notificar" : "Não notificar esta cobrança"}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void setNotify(quiet)}
                className="min-h-8 items-end justify-center px-1"
              >
                <Text className="text-[11px] font-semibold text-muted">{quiet ? "Voltar a notificar" : "Não notificar esta cobrança"}</Text>
              </Pressable>
            )}
          </View>
        )}

        {guidance && (
          <View className="rounded-2xl bg-surface-muted p-4">
            <Text className="text-sm leading-5 text-muted">{guidance}</Text>
          </View>
        )}

        {/* A registro has no proof: "Marcar como pago" moved to the quick actions. */}
        {proofsEnabled && !charge.settled && (
          <ProofCard
            charge={charge}
            busy={busy}
            onView={() => onOpenProof?.()}
            onUpload={() => void uploadProof()}
            onAccept={() => confirmPaid(acceptProof)}
            onWithdraw={proof ? () => void withdrawProof() : undefined}
            onDeclare={client.declarePayment ? () => confirmDeclare(charge) : undefined}
            onReject={() => setRejecting(true)}
          />
        )}

        {sharer && charge.sharingState === "pix_required" && client.paymentMethods && client.savePaymentMethod && (
          <FirstSharePix client={client as FinancialClient} busy={busy} publish={(methodId) => shareLink(false, methodId)} />
        )}

        {charge.sharingState === "legacy_without_pix" && (
          <Text className="text-xs leading-4 text-muted">
            Esta cobrança foi publicada sem Pix. O histórico não pode ser alterado nem receber um novo link; combine o pagamento manualmente com o credor.
          </Text>
        )}
      </ScrollView>

      {pending && !settleable && (uploadProofAllowed || viewable) && (
        <View className="border-t border-outline/20 bg-canvas px-5 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={footerLabel}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => (uploadProofAllowed ? void uploadProof() : onOpenProof?.())}
            className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
          >
            <Image source={footerIcon} tintColor={colors.onPrimary} style={{ width: 18, height: 18 }} />
            <Text className="text-sm font-bold text-on-primary">{footerLabel}</Text>
          </Pressable>
        </View>
      )}

      <RejectReasonSheet visible={rejecting} busy={busy} onCancel={() => setRejecting(false)} onConfirm={(reason) => void rejectDeclaration(reason)} />

      {notice ? <Toast message={notice} onDismiss={() => setNotice("")} /> : null}
    </SafeAreaView>
  );
}
