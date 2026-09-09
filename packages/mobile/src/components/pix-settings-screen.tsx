import { pixKeyField, type PaymentMethod, type PixKeyType } from "@receivy/common";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { ACTIVE_TINT, MUTED_TINT } from "./tab-bar";

type PixSettingsClient = Pick<FinancialClient, "paymentMethods" | "defaultPaymentMethod" | "archivePaymentMethod">;

type PixSettingsScreenProps = {
  client?: PixSettingsClient;
  required?: boolean;
  /** Absent when the screen cannot navigate to the key form. */
  onNewKey?: () => void;
};

const LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "Celular",
  email: "E-mail",
  random: "Chave aleatória",
};

const copyMark = require("../../assets/images/auth/copy.svg");
const keyMark = require("../../assets/images/auth/key.svg");
const mailMark = require("../../assets/images/auth/mail.svg");
const moreMark = require("../../assets/images/auth/more.svg");
const plusMark = require("../../assets/images/auth/plus.svg");
const starMark = require("../../assets/images/auth/star.svg");

const ICONS = {
  cpf: require("../../assets/images/auth/id-card.svg"),
  cnpj: require("../../assets/images/auth/building.svg"),
  phone: require("../../assets/images/auth/phone.svg"),
  email: mailMark,
  random: keyMark,
} satisfies Record<PixKeyType, unknown>;

const LIST_ERROR = "Não foi possível carregar suas chaves Pix.";
const UPDATE_ERROR = "Não foi possível atualizar suas chaves Pix.";
const COPY_ERROR = "Não foi possível copiar a chave.";
const REQUIRED_NOTICE = "Você precisa de uma chave Pix para criar cobranças.";
const SAFETY_NOTE = "Seus dados Pix ficam protegidos e nunca são compartilhados sem sua autorização.";

/** The Pix key agenda: copy, promote and delete. Registering happens on `/settings/pix/new`. */
export function PixSettingsScreen({ client = financialClient, required = false, onNewKey }: PixSettingsScreenProps) {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return client
      .paymentMethods()
      .then((page) => {
        setItems(page.paymentMethods.filter((method) => !method.archivedAt));
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : LIST_ERROR))
      .finally(() => setLoading(false));
  }, [client]);

  // The key form lives on its own screen, so coming back has to show what it saved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function copy(method: PaymentMethod) {
    setError("");
    setNotice("");

    try {
      await Clipboard.setStringAsync(method.pixKey);
      setNotice("Chave copiada");
    } catch {
      setError(COPY_ERROR);
    }
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : UPDATE_ERROR);
      setBusy(false);
      return;
    }

    setMenu(null);
    setNotice(done);
    await load();
    setBusy(false);
  }

  function confirmRemoval(method: PaymentMethod) {
    Alert.alert("Excluir chave Pix?", "A chave sai dos próximos links de cobrança. As cobranças já criadas não mudam.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => void act(() => client.archivePaymentMethod(method.id), "Chave excluída.") },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-32 pt-3" showsVerticalScrollIndicator={false}>
        {required ? <Text className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{REQUIRED_NOTICE}</Text> : null}

        <Text className="text-xs font-bold tracking-wider text-muted">CHAVES ATIVAS ({items.length})</Text>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
            {error}
          </Text>
        ) : null}

        {notice ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-primary-soft/50 p-4 font-semibold text-primary-strong">
            {notice}
          </Text>
        ) : null}

        {loading && !items.length ? <ActivityIndicator accessibilityLabel="Carregando chaves Pix" color={ACTIVE_TINT} /> : null}

        {!loading && !error && !items.length ? (
          <View className="items-center gap-2 rounded-3xl border border-outline/40 bg-surface p-8">
            <Text className="text-lg font-extrabold text-primary-strong">Nenhuma chave ainda</Text>
            <Text className="text-center text-sm leading-5 text-muted">Cadastre uma chave para receber pelos links de cobrança.</Text>
          </View>
        ) : null}

        {items.map((method) => (
          <View
            key={method.id}
            className={`gap-3 rounded-2xl border border-outline/40 bg-surface p-4 ${method.isDefault ? "border-l-4 border-l-primary" : ""}`}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                <Image source={ICONS[method.pixKeyType]} tintColor={ACTIVE_TINT} style={{ width: 18, height: 18 }} />
              </View>

              <View className="flex-1">
                <Text className="text-base font-bold text-ink">{LABELS[method.pixKeyType]}</Text>
                {method.label ? <Text className="text-xs text-muted">{method.label}</Text> : null}
              </View>

              {method.isDefault ? (
                <Text className="rounded-full bg-primary-soft/50 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">Principal</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mais opções"
                accessibilityState={{ expanded: menu === method.id }}
                onPress={() => setMenu((current) => (current === method.id ? null : method.id))}
                className="h-11 w-11 items-center justify-center"
              >
                <Image source={moreMark} tintColor={MUTED_TINT} style={{ width: 18, height: 18 }} />
              </Pressable>
            </View>

            <View className="rounded-xl bg-surface-muted p-3">
              <Text selectable className="text-sm text-ink">
                {pixKeyField(method.pixKeyType).format(method.pixKey)}
              </Text>
            </View>

            <View className="flex-row flex-wrap items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copiar chave"
                onPress={() => void copy(method)}
                className="min-h-11 flex-row items-center gap-2 rounded-xl border border-outline/60 px-3"
              >
                <Image source={copyMark} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
                <Text className="text-sm font-bold text-primary">Copiar chave</Text>
              </Pressable>

              {method.isDefault ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tornar padrão"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void act(() => client.defaultPaymentMethod(method.id), "Chave principal atualizada.")}
                  className="min-h-11 flex-row items-center gap-2 rounded-xl border border-outline/60 px-3"
                >
                  <Image source={starMark} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
                  <Text className="text-sm font-bold text-primary">Tornar padrão</Text>
                </Pressable>
              )}
            </View>

            {menu === method.id ? (
              <View className="flex-row border-t border-outline/40 pt-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Excluir"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => confirmRemoval(method)}
                  className="min-h-11 justify-center"
                >
                  <Text className="font-bold text-red-700">Excluir</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        <Text className="text-xs leading-5 text-muted">{SAFETY_NOTE}</Text>
      </ScrollView>

      {onNewKey ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cadastrar nova chave"
          onPress={onNewKey}
          className="absolute bottom-8 right-5 h-14 flex-row items-center gap-2 rounded-full bg-primary px-5"
        >
          <Image source={plusMark} tintColor="#ffffff" style={{ width: 18, height: 18 }} />
          <Text className="font-bold text-white">Cadastrar nova chave</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}
