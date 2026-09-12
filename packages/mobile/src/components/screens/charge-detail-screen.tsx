import { useCallback, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { calendarDate, formatMoney, type ChargeDetail, type PixKeyType, type ProofDetail } from "@receivy/common";
import { FirstSharePix } from "@/components/app/first-share-pix";
import { ProofCard } from "@/components/app/proof-card";
import { ActionTile } from "@/components/ui/action-tile";
import { CopyButton } from "@/components/ui/copy-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { StatusTag } from "@/components/ui/status-tag";
import { financialClient, type FinancialClient } from "@/financial/client";
import {
  canAcceptProof,
  canUploadProof,
  chargeStateLabel,
  chargeStatusLine,
  chargeTypeLabel,
  dateText,
  latestProof,
} from "@/financial/charge-text";
import { pickAndUploadProof } from "@/financial/proof-upload";
import { notificationClient } from "@/notifications/client";
import { ACTIVE_TINT } from "@/theme/colors";

export type ProofClient = Pick<FinancialClient, "proofs" | "uploadIntent" | "finalizeProof" | "reviewProof" | "downloadProof">;

type Client = Pick<FinancialClient, "charge" | "cancel" | "pay" | "publicLink" | "publicChargeUrl"> &
  Partial<ProofClient & Pick<FinancialClient, "paymentMethods" | "savePaymentMethod">>;

type ChargeDetailScreenProps = {
  id: string;
  client?: Client;
  notifications?: Pick<typeof notificationClient, "remind">;
  /** Opens the proof viewer; also used as the preview right after the debtor sends a file. */
  onOpenProof?: () => void;
};

const LOAD_ERROR = "Não foi possível carregar a cobrança.";

const PIX_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Celular",
  random: "Aleatória",
};

const ICONS = {
  check: require("../../../assets/images/auth/check.svg"),
  share: require("../../../assets/images/auth/share.svg"),
  bell: require("../../../assets/images/auth/bell.svg"),
  stop: require("../../../assets/images/auth/stop.svg"),
  copy: require("../../../assets/images/auth/copy.svg"),
  receipt: require("../../../assets/images/auth/receipt.svg"),
  upload: require("../../../assets/images/auth/upload.svg"),
  eye: require("../../../assets/images/auth/eye.svg"),
  key: require("../../../assets/images/auth/key.svg"),
  calendar: require("../../../assets/images/auth/calendar.svg"),
} as const;

const STATUS_COLOR = {
  success: "text-primary",
  warning: "text-amber-700",
  danger: "text-red-700",
  neutral: "text-muted",
  info: "text-blue-800",
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

  return charge.pix ? null : "A chave Pix ainda não está disponível. Combine o pagamento com o credor.";
}

export function ChargeDetailScreen({ id, client = financialClient, notifications = notificationClient, onOpenProof }: ChargeDetailScreenProps) {
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const [proofs, setProofs] = useState<ProofDetail[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let live = true;

    // Proofs are optional for the caller; losing them must not hide the charge.
    Promise.all([client.charge(id), client.proofs ? client.proofs(id).catch(() => ({ proofs: [] })) : { proofs: [] }])
      .then(([detail, page]) => {
        if (!live) {
          return;
        }

        setCharge(detail);
        setProofs(page.proofs);
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

  async function refresh() {
    setCharge(await client.charge(id));

    if (client.proofs) {
      setProofs((await client.proofs(id)).proofs);
    }
  }

  async function markPaid(proof: ProofDetail | null) {
    await run(async () => {
      if (proof && client.reviewProof) {
        await client.reviewProof(id, proof.id, "accepted");
        await refresh();
        setNotice("Comprovante aceito e pagamento registrado.");
        return;
      }

      setCharge(await client.pay(id));
      setNotice("Pagamento integral registrado.");
    }, "Não foi possível atualizar a cobrança.");
  }

  function confirmPaid(proof: ProofDetail | null) {
    Alert.alert("Marcar como paga?", "Isso registra um pagamento integral e encerra a cobrança.", [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar paga", onPress: () => void markPaid(proof) },
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

      if (paymentMethodId) {
        setCharge(await client.charge(id));
      }

      const url = client.publicChargeUrl(result.token);

      await Share.share({ title: "Cobrança Receivy", message: url, url });
    }, "Não foi possível compartilhar o link.");
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
    if (!client.uploadIntent || !client.finalizeProof) {
      return;
    }

    const proof = await run(() => pickAndUploadProof(id, client as ProofClient), "Não foi possível enviar o comprovante.");

    if (!proof) {
      return;
    }

    setProofs((previous) => [...previous, proof]);
    onOpenProof?.();
  }

  if (!charge) {
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
          <ActivityIndicator accessibilityLabel="Carregando cobrança" color={ACTIVE_TINT} size="large" />
        )}
      </SafeAreaView>
    );
  }

  const receivable = charge.direction === "receivable";
  const pending = charge.state === "pending";
  const proof = latestProof(proofs);
  const state = chargeStateLabel(charge);
  const status = chargeStatusLine(charge, calendarDate());
  const guidance = payableGuidance(charge);
  const canShare = receivable && pending && !!charge.pix;
  const acceptProof = canAcceptProof(charge, proof);
  const uploadProofAllowed = canUploadProof(charge, proof);
  const proofsEnabled = !!client.proofs;

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-6 pt-4" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="rounded-xl bg-primary-soft/40 p-3 text-sm text-primary-strong">
            {notice}
          </Text>
        ) : null}

        {/* Hero: the same card the billing detail opens with, scoped to one person */}
        <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-5">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${receivable ? "bg-primary-soft/50 text-primary-strong" : "bg-violet-100 text-violet-900"}`}>
                {receivable ? "A receber" : "A pagar"}
              </Text>
              <Text className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-900">{chargeTypeLabel(charge)}</Text>
            </View>
            <StatusTag label={state.label} tone={state.tone} compact />
          </View>

          <Text accessibilityRole="header" className="text-[22px] font-bold tracking-tight text-primary-strong">
            {charge.description}
          </Text>

          <View className="flex-row items-center gap-3">
            <InitialsAvatar name={charge.recipient.name} size={40} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                {charge.recipient.name}
              </Text>
              <Text className="text-[11px] text-muted">{receivable ? "Vai pagar para você" : "Vai receber de você"}</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-1.5">
            <Image source={ICONS.calendar} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
            <Text className="text-xs text-muted">
              Vencimento: <Text className="font-semibold text-ink">{dateText(charge.dueDate)}</Text>
              {pending && <Text className={STATUS_COLOR[status.tone]}> ({status.text.toLocaleLowerCase("pt-BR")})</Text>}
            </Text>
          </View>

          <View className="flex-row items-center justify-between border-t border-outline/20 pt-3">
            <View className="flex-1 flex-row items-center gap-1.5">
              <Image source={ICONS.key} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
              <Text className="flex-1 text-[11px] text-muted" numberOfLines={1}>
                {charge.pix ? (
                  <>
                    Chave Pix: <Text className="font-medium text-ink">{charge.pix.key}</Text>
                    {` • ${PIX_TYPE_LABELS[charge.pix.keyType]}`}
                  </>
                ) : (
                  "Sem chave Pix vinculada"
                )}
              </Text>
            </View>
            {charge.pix && <CopyButton value={charge.pix.key} accessibilityLabel="Copiar chave Pix" onRefused={() => setError("Não foi possível copiar a chave.")} />}
          </View>
        </View>

        {/* Amount */}
        <View className="items-center gap-1 rounded-2xl border border-outline/30 bg-surface p-5">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted">{receivable ? "Valor a receber" : "Valor a pagar"}</Text>
          <Text className="text-4xl font-extrabold tracking-tight text-primary-strong">{formatMoney(charge.amount)}</Text>
          <Text className={`text-xs font-medium ${STATUS_COLOR[status.tone]}`}>{status.text}</Text>
        </View>

        {/* Quick actions */}
        {receivable && pending && (
          <View className="gap-2.5">
            <View className="flex-row gap-2">
              <ActionTile label="Marcar pago" icon={ICONS.check} tone="primary" hint="Registra o pagamento integral" disabled={busy} onPress={() => confirmPaid(acceptProof ? proof : null)} />
              {canShare && <ActionTile label="Compartilhar" icon={ICONS.share} hint="Envia o link público de pagamento" disabled={busy} onPress={() => void shareLink()} />}
              {charge.pix && <ActionTile label="Lembrar Pix" icon={ICONS.bell} hint="Envia um lembrete de pagamento" disabled={busy} onPress={() => void remind(charge)} />}
              <ActionTile label="Cancelar" icon={ICONS.stop} tone="danger" hint="Encerra a cobrança sem pagamento" disabled={busy} onPress={confirmCancel} />
            </View>
            {canShare && (
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
          </View>
        )}

        {!receivable && pending && (
          <View className="flex-row gap-2">
            {charge.pix && <ActionTile label="Copiar Pix" icon={ICONS.copy} hint="Copia a chave Pix do credor" disabled={busy} onPress={() => void copyPix(charge.pix!.key)} />}
            {proofsEnabled && (
              <ActionTile
                label={proof ? "Comprovante" : "Enviar comprovante"}
                icon={proof ? ICONS.eye : ICONS.upload}
                tone="primary"
                hint={proof ? "Abre o comprovante enviado" : "Envia o comprovante de pagamento"}
                disabled={busy}
                onPress={() => (proof ? onOpenProof?.() : void uploadProof())}
              />
            )}
          </View>
        )}

        {guidance && (
          <View className="rounded-2xl bg-surface-muted p-4">
            <Text className="text-sm leading-5 text-muted">{guidance}</Text>
          </View>
        )}

        {proofsEnabled && (
          <ProofCard charge={charge} proof={proof} busy={busy} onView={() => onOpenProof?.()} onUpload={() => void uploadProof()} onAccept={() => confirmPaid(proof)} />
        )}

        {receivable && charge.sharingState === "pix_required" && client.paymentMethods && client.savePaymentMethod && (
          <FirstSharePix client={client as FinancialClient} busy={busy} publish={(methodId) => shareLink(false, methodId)} />
        )}

        {charge.sharingState === "legacy_without_pix" && (
          <Text className="text-xs leading-4 text-muted">
            Esta cobrança foi publicada sem Pix. O histórico não pode ser alterado nem receber um novo link; combine o pagamento manualmente com o credor.
          </Text>
        )}
      </ScrollView>

      {pending && (receivable || uploadProofAllowed || proof) && (
        <View className="border-t border-outline/20 bg-canvas px-5 py-3">
          {receivable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Marcar cobrança como paga"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => confirmPaid(acceptProof ? proof : null)}
              className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
            >
              <Image source={ICONS.check} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-white">Marcar cobrança como paga</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uploadProofAllowed ? (proof ? "Enviar novo comprovante" : "Enviar comprovante") : "Ver comprovante enviado"}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => (uploadProofAllowed ? void uploadProof() : onOpenProof?.())}
              className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
            >
              <Image source={uploadProofAllowed ? ICONS.upload : ICONS.eye} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-white">{uploadProofAllowed ? (proof ? "Enviar novo comprovante" : "Enviar comprovante") : "Ver comprovante enviado"}</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
