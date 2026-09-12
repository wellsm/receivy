import { useCallback, useState } from "react";
import { Image } from "expo-image";
import Pdf from "react-native-pdf";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { canAcceptProof, canUploadProof, fileSizeText, momentText, proofNote, proofStateLabel, type ChargeDetail } from "@receivy/common";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { StatusTag } from "@/components/ui/status-tag";
import { financialClient, type FinancialClient } from "@/financial/client";
import { pickAndUploadProof } from "@/financial/proof-upload";
import { ACTIVE_TINT } from "@/theme/colors";

type Client = Pick<FinancialClient, "charge" | "startProofUpload" | "reviewProof" | "downloadProof">;

type ProofViewerScreenProps = {
  chargeId: string;
  client?: Client;
  /** Called once the creditor settled the proof; the route pops back to the charge. */
  onDone?: () => void;
};

const LOAD_ERROR = "Não foi possível carregar o comprovante.";

const ICONS = {
  check: require("../../../assets/images/auth/check.svg"),
  x: require("../../../assets/images/auth/x.svg"),
  upload: require("../../../assets/images/auth/upload.svg"),
} as const;

export function ProofViewerScreen({ chargeId, client = financialClient, onDone }: ProofViewerScreenProps) {
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let live = true;

    client
      .charge(chargeId)
      .then(async (detail) => {
        // The download link is signed and short-lived, so it is fetched together with the file it shows.
        const link = detail.proof ? await client.downloadProof(chargeId) : null;

        if (!live) {
          return;
        }

        setCharge(detail);
        setUrl(link?.url ?? "");
        setError("");
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (!live) {
          return;
        }

        setError(failure instanceof Error ? failure.message : LOAD_ERROR);
        setLoaded(true);
      });

    return () => {
      live = false;
    };
  }, [client, chargeId]);

  useFocusEffect(load);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: "accepted" | "rejected") {
    await run(async () => {
      await client.reviewProof(chargeId, decision, reason.trim() || undefined);
      onDone?.();
    }, "Não foi possível revisar o comprovante.");
  }

  function confirmAccept() {
    Alert.alert("Marcar como pago?", "Isso aceita o comprovante e registra o pagamento integral.", [
      { text: "Voltar", style: "cancel" },
      { text: "Marcar pago", onPress: () => void review("accepted") },
    ]);
  }

  async function replace() {
    await run(async () => {
      const detail = await pickAndUploadProof(chargeId, client);

      if (!detail) {
        return;
      }

      const link = await client.downloadProof(chargeId);

      setCharge(detail);
      setUrl(link.url);
    }, "Não foi possível enviar o comprovante.");
  }

  async function openFile() {
    if (!url) {
      return;
    }

    await run(async () => {
      await WebBrowser.openBrowserAsync(url);
    }, "Não foi possível abrir o arquivo.");
  }

  if (!loaded) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas" edges={["bottom"]}>
        <ActivityIndicator accessibilityLabel="Carregando comprovante" color={ACTIVE_TINT} size="large" />
      </SafeAreaView>
    );
  }

  const proof = charge?.proof;

  if (!charge || !proof) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas" edges={["bottom"]}>
        <View className="gap-3 px-5">
          <Text accessibilityRole={error ? "alert" : undefined} className="text-center text-muted">
            {error || "Nenhum comprovante enviado."}
          </Text>
          {error ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Tentar novamente" onPress={load} className="min-h-12 items-center justify-center">
              <Text className="font-bold text-primary">Tentar novamente</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const state = proofStateLabel(proof);
  const note = proofNote(charge);
  const accept = canAcceptProof(charge);
  const replaceAllowed = canUploadProof(charge);
  const isPdf = proof.file.mime === "application/pdf";

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-6 pt-4" showsVerticalScrollIndicator={false}>
        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </Text>
        ) : null}

        <View className="gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-1">
              <Text accessibilityRole="header" className="text-base font-bold text-ink" numberOfLines={1}>
                {proof.file.name}
              </Text>
              <Text className="text-[11px] text-muted">
                {fileSizeText(proof.file.size)} • Enviado em {momentText(proof.sentAt)}
              </Text>
            </View>
            <StatusTag label={state.label} tone={state.tone} />
          </View>

          {isPdf ? (
            <View accessibilityLabel={`Comprovante ${proof.file.name}`} className="overflow-hidden rounded-xl bg-surface-muted" style={{ width: "100%", aspectRatio: 3 / 4 }}>
              {url ? <Pdf source={{ uri: url, cache: false }} trustAllCerts={false} style={{ flex: 1, backgroundColor: "transparent" }} /> : null}
            </View>
          ) : (
            <Pressable accessibilityRole="imagebutton" accessibilityLabel="Abrir comprovante em tamanho real" onPress={() => void openFile()} className="overflow-hidden rounded-xl bg-surface-muted">
              <Image source={{ uri: url }} contentFit="contain" accessibilityLabel={`Comprovante ${proof.file.name}`} style={{ width: "100%", aspectRatio: 3 / 4 }} />
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir no navegador"
            accessibilityState={{ disabled: busy || !url }}
            disabled={busy || !url}
            onPress={() => void openFile()}
            className="min-h-11 items-center justify-center"
          >
            <Text className="text-sm font-semibold text-primary">Abrir no navegador</Text>
          </Pressable>

          {note && <Text className="text-xs leading-4 text-muted">{note}</Text>}
        </View>

        {accept && (
          <View className="gap-2 rounded-2xl border border-outline/30 bg-surface p-4">
            <Text className="text-sm font-semibold text-ink">Motivo (opcional)</Text>
            <TextInput
              accessibilityLabel="Motivo opcional"
              placeholder="Usado apenas se você rejeitar"
              placeholderTextColor="#8A94A6"
              maxLength={500}
              value={reason}
              onChangeText={setReason}
              className="min-h-12 rounded-xl border border-outline/50 px-3 text-[15px] text-ink"
            />
          </View>
        )}
      </ScrollView>

      {(accept || replaceAllowed) && (
        <View className="flex-row gap-2 border-t border-outline/20 bg-canvas px-5 py-3">
          {accept ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rejeitar comprovante"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void review("rejected")}
                className={`h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-outline/50 ${busy ? "opacity-50" : ""}`}
              >
                <Image source={ICONS.x} tintColor="#b91c1c" style={{ width: 18, height: 18 }} />
                <Text className="text-sm font-bold text-red-700">Rejeitar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Marcar como pago"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={confirmAccept}
                className={`h-[52px] flex-[2] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
              >
                <Image source={ICONS.check} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
                <Text className="text-sm font-bold text-white">Marcar como pago</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar novo comprovante"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void replace()}
              className={`h-[52px] flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-50" : ""}`}
            >
              <Image source={ICONS.upload} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-white">Enviar novo comprovante</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
