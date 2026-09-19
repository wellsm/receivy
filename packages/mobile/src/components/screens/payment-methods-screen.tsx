import { paymentMethodCopyValue, paymentMethodText, PaymentProvider, type PaymentMethod, type PixKeyType } from "@receivy/common";
import { CopyButton } from "@/components/ui/copy-button";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { useThemeColors } from "@/theme/colors";

type PaymentMethodsClient = Pick<FinancialClient, "paymentMethods" | "defaultPaymentMethod" | "archivePaymentMethod">;

type PaymentMethodsScreenProps = {
  client?: PaymentMethodsClient;
  required?: boolean;
  /** Absent when the screen cannot navigate to the method form. */
  onNewMethod?: () => void;
};

const keyMark = require("../../../assets/images/auth/key.svg");
const mailMark = require("../../../assets/images/auth/mail.svg");
const plusMark = require("../../../assets/images/auth/plus.svg");
const checkMark = require("../../../assets/images/auth/check.svg");
const trashMark = require("../../../assets/images/auth/trash.svg");
const lockMark = require("../../../assets/images/auth/lock.svg");
const infinityMark = require("../../../assets/images/auth/infinity.svg");
const bankMark = require("../../../assets/images/auth/bank.svg");

const ICONS: Record<PixKeyType, number> = {
  cpf: require("../../../assets/images/auth/id-card.svg"),
  cnpj: require("../../../assets/images/auth/building.svg"),
  phone: require("../../../assets/images/auth/phone.svg"),
  email: mailMark,
  random: keyMark,
};

function iconOf(method: PaymentMethod): number {
  if (method.provider === PaymentProvider.PagSeguro) {
    return bankMark;
  }

  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return infinityMark;
  }

  return ICONS[method.kind];
}

const LIST_ERROR = "Não foi possível carregar seus meios de pagamento.";
const UPDATE_ERROR = "Não foi possível atualizar seus meios de pagamento.";
const COPY_ERROR = "Não foi possível copiar o valor.";
const REQUIRED_NOTICE = "Você precisa de um meio de pagamento para criar cobranças.";
const SAFETY_NOTE = "Seus dados de recebimento ficam protegidos e nunca são compartilhados sem sua autorização.";

/** The payment method agenda: copy, promote and delete. Registering happens on `/settings/payment-methods/new`. */
export function PaymentMethodsScreen({ client = financialClient, required = false, onNewMethod }: PaymentMethodsScreenProps) {
  const colors = useThemeColors();
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);
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

  // The method form lives on its own screen, so coming back has to show what it saved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

    setRemoving(null);
    setNotice(done);

    await load();

    setBusy(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-32 pt-4" showsVerticalScrollIndicator={false}>
        {required ? <Text className="rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning">{REQUIRED_NOTICE}</Text> : null}

        <Text className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Meios ativos ({items.length})</Text>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
            {error}
          </Text>
        ) : null}

        {notice ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-primary-soft/50 p-4 font-semibold text-primary-strong">
            {notice}
          </Text>
        ) : null}

        {loading && !items.length ? <ActivityIndicator accessibilityLabel="Carregando meios de pagamento" color={colors.primaryStrong} /> : null}

        {!loading && !error && !items.length ? (
          <View className="items-center gap-2 rounded-2xl border border-outline/40 bg-surface p-8">
            <Text className="text-lg font-extrabold text-primary-strong">Nenhum meio de pagamento</Text>
            <Text className="text-center text-sm leading-5 text-muted">Cadastre uma chave Pix ou sua InfiniteTag para receber pelos links de cobrança.</Text>
          </View>
        ) : null}

        {items.map((method) => {
          const text = paymentMethodText(method);
          const copyValue = paymentMethodCopyValue(method);

          return (
            <View key={method.id} className="gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 flex-row items-center gap-3">
                  <View className={`h-10 w-10 items-center justify-center rounded-xl ${method.isDefault ? "bg-primary" : "bg-surface-muted"}`}>
                    <Image source={iconOf(method)} tintColor={method.isDefault ? colors.onPrimary : colors.primaryStrong} style={{ width: 20, height: 20 }} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-base font-bold text-ink">{text.title}</Text>
                    <View className="flex-row">
                      {method.isDefault ? (
                        <View className="flex-row items-center gap-1 rounded-full bg-primary-soft/70 px-2 py-0.5">
                          <Image source={checkMark} tintColor={colors.primaryStrong} style={{ width: 11, height: 11 }} />
                          <Text className="text-[11px] font-semibold text-primary-strong">Padrão</Text>
                        </View>
                      ) : (
                        <Text className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">Secundário</Text>
                      )}
                    </View>
                  </View>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Excluir"
                  accessibilityHint={`Remove o meio ${text.title}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => setRemoving(method)}
                  className="h-9 w-9 items-center justify-center rounded-lg"
                >
                  <Image source={trashMark} tintColor={colors.danger} style={{ width: 18, height: 18 }} />
                </Pressable>
              </View>

              <View className="flex-row items-center justify-between gap-2 rounded-xl border border-outline/30 bg-surface-muted/70 p-3">
                <Text selectable numberOfLines={1} className="flex-1 text-[15px] font-bold tracking-wider text-ink">
                  {text.value}
                </Text>
                {copyValue ? (
                  <CopyButton value={copyValue} accessibilityLabel="Copiar valor" variant="outline" onRefused={() => setError(COPY_ERROR)} />
                ) : null}
              </View>

              {method.isDefault ? null : (
                <View className="flex-row border-t border-outline/20 pt-3">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tornar padrão"
                    accessibilityState={{ disabled: busy }}
                    disabled={busy}
                    onPress={() => void act(() => client.defaultPaymentMethod(method.id), "Meio principal atualizado.")}
                    className="min-h-10 flex-row items-center gap-1.5 rounded-lg border border-outline/40 px-3"
                  >
                    <Image source={checkMark} tintColor={colors.success} style={{ width: 16, height: 16 }} />
                    <Text className="text-xs font-semibold text-primary">Tornar padrão</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        <View className="flex-row items-start gap-3 rounded-2xl border border-outline/30 bg-surface-muted/70 p-4">
          <View className="h-8 w-8 items-center justify-center rounded-lg bg-primary-soft/60">
            <Image source={lockMark} tintColor={colors.success} style={{ width: 18, height: 18 }} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-xs font-bold text-ink">Privacidade</Text>
            <Text className="text-xs leading-5 text-muted">{SAFETY_NOTE}</Text>
          </View>
        </View>
      </ScrollView>

      {onNewMethod ? (
        <View className="absolute bottom-0 left-0 right-0 bg-canvas/95 px-4 pb-8 pt-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cadastrar novo meio"
            onPress={onNewMethod}
            className="h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary"
          >
            <Image source={plusMark} tintColor={colors.onPrimary} style={{ width: 20, height: 20 }} />
            <Text className="text-base font-bold text-on-primary">Cadastrar Novo Meio</Text>
          </Pressable>
        </View>
      ) : null}

      {removing && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setRemoving(null)}>
          <View className="flex-1 items-center justify-center bg-scrim px-4">
            <View className="w-full max-w-sm gap-4 rounded-2xl border border-outline/30 bg-surface p-5">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
                  <Image source={trashMark} tintColor={colors.danger} style={{ width: 22, height: 22 }} />
                </View>
                <View className="flex-1">
                  <Text accessibilityRole="header" className="text-[17px] font-bold text-ink">
                    Excluir meio de pagamento?
                  </Text>
                  <Text className="text-[11px] text-muted">Esta ação não pode ser desfeita.</Text>
                </View>
              </View>
              <View className="gap-1 rounded-xl border border-outline/30 bg-surface-muted/70 p-3">
                <Text className="text-[11px] font-medium text-muted">{paymentMethodText(removing).title}</Text>
                <Text className="text-sm font-bold text-ink">{paymentMethodText(removing).value}</Text>
              </View>
              <Text className="text-xs leading-5 text-muted">O meio sai dos próximos links de cobrança. As cobranças já criadas não mudam.</Text>
              <View className="flex-row gap-2.5 pt-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={() => setRemoving(null)}
                  className="h-11 flex-1 items-center justify-center rounded-xl border border-outline/50"
                >
                  <Text className="text-sm font-semibold text-ink">Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remover"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void act(() => client.archivePaymentMethod(removing.id), "Meio de pagamento excluído.")}
                  className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-danger-solid"
                >
                  <Image source={trashMark} tintColor="white" style={{ width: 16, height: 16 }} />
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
