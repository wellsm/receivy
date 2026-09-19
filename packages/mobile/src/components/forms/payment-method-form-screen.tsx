import { pixKeyField, PaymentProvider, type PaymentMethod, type PaymentMethodInput, PixKeyType } from "@receivy/common";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { profileStore, type ProfileStore } from "@/account/profile";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, FinancialRequestError, type FinancialClient } from "@/financial/client";
import { patchDraft } from "@/financial/draft-store";
import { useThemeColors } from "@/theme/colors";

type PaymentMethodFormClient = Pick<FinancialClient, "paymentMethods" | "savePaymentMethod" | "defaultPaymentMethod">;

type PaymentMethodFormScreenProps = {
  client?: PaymentMethodFormClient;
  profile?: Pick<ProfileStore, "load">;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  required?: boolean;
  onSaved?: (method: PaymentMethod) => void;
};

const starMark = require("../../../assets/images/auth/star.svg");
const checkMark = require("../../../assets/images/auth/check.svg");

const INFINITEPAY_CHECKOUT_URL = "https://app.infinitepay.io/external-checkout";

const REQUIRED_NOTICE = "Você precisa de um meio de pagamento para criar cobranças.";
const SAVE_ERROR = "Não foi possível salvar o meio de pagamento.";
const EMPTY_PIX_ERROR = "Informe a chave Pix.";
const EMPTY_TAG_ERROR = "Informe a InfiniteTag.";

/** The payment method form on its own screen, reached from the method list or the billing gate. */
export function PaymentMethodFormScreen({ client = financialClient, profile = profileStore, returnTo, required = false, onSaved }: PaymentMethodFormScreenProps) {
  const colors = useThemeColors();
  const [provider, setProvider] = useState<PaymentProvider>(PaymentProvider.Pix);
  const [type, setType] = useState<PixKeyType>(PixKeyType.Email);
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [handle, setHandle] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);

  // A ref, not state: the list request reads it from the closure created at mount.
  const defaultTouched = useRef(false);

  useEffect(() => {
    let live = true;

    void client
      .paymentMethods()
      .then((page) => {
        if (!live) {
          return;
        }

        // The very first key of an account is its main one; later keys only take
        // over when the person says so. A choice made while this request was in
        // flight wins — the answer must never flip a switch the user just set.
        setMakeDefault((current) => (defaultTouched.current ? current : !page.paymentMethods.some((method) => !method.archivedAt)));
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [client]);

  useEffect(() => {
    let live = true;

    void profile
      .load()
      .then((user) => {
        if (!live) {
          return;
        }

        if (user.email) {
          setAccountEmail(user.email);
        }

        if (user.phone) {
          setAccountPhone(pixKeyField(PixKeyType.Phone).format(user.phone));
        }
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [profile]);

  const spec = pixKeyField(type);
  // Most people register their own e-mail or phone, so an untouched field shows the
  // account value of that type. It stays editable: typing — or clearing it — takes
  // over, and picking another type starts over.
  const prefilled = type === "email" ? accountEmail : type === "phone" ? accountPhone : "";
  const value = !key && !touched ? prefilled : key;

  function pick(next: PixKeyType) {
    setType(next);
    setKey("");
    setTouched(false);
    setError("");
  }

  function change(raw: string) {
    setTouched(true);
    setKey(pixKeyField(type).format(raw));
  }

  function clear() {
    setTouched(true);
    setKey("");
  }

  async function save() {
    setError("");
    setErrorStatus(0);

    let input: PaymentMethodInput;

    if (provider === PaymentProvider.InfinitePay) {
      if (!handle.trim()) {
        setError(EMPTY_TAG_ERROR);

        return;
      }

      input = { provider: PaymentProvider.InfinitePay, value: handle };
    } else {
      const pixKey = spec.unformat(value);

      // The web input carries `required`, so the browser blocks an empty submit.
      // On mobile the guard has to be here, or the API answers with a generic
      // failure that never names the real problem.
      if (!pixKey) {
        setError(EMPTY_PIX_ERROR);

        return;
      }

      input = { provider: PaymentProvider.Pix, kind: type, value: pixKey };
    }

    setBusy(true);

    try {
      const saved = await client.savePaymentMethod(input);

      if (makeDefault && !saved.isDefault) {
        await client.defaultPaymentMethod(saved.id);
      }

      // Came from the billing form: hand the key back to the parked draft.
      if (returnTo === "new-billing") {
        patchDraft({ pix: saved.id });
      }

      onSaved?.(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
      setErrorStatus(reason instanceof FinancialRequestError ? reason.status : 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-5 pb-32 pt-5" showsVerticalScrollIndicator={false}>
        {required ? <Text className="rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning">{REQUIRED_NOTICE}</Text> : null}

        <View className="gap-2">
          <Text className="text-xs font-semibold text-muted">Tipo de meio</Text>
          <View accessibilityRole="radiogroup" className="flex-row gap-2">
            {[
              { value: PaymentProvider.Pix, label: "Pix" },
              { value: PaymentProvider.InfinitePay, label: "InfinitePay" },
            ].map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: provider === option.value }}
                onPress={() => {
                  setProvider(option.value);
                  setError("");
                  setErrorStatus(0);
                }}
                className={`min-h-11 flex-1 items-center justify-center rounded-xl border px-3 ${provider === option.value ? "border-primary bg-primary-soft/40" : "border-outline/40 bg-surface"}`}
              >
                <Text className={`text-sm font-semibold ${provider === option.value ? "text-primary-strong" : "text-ink"}`}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {provider === PaymentProvider.Pix ? (
          <PixKeyFields type={type} value={value} onPickType={pick} onChangeKey={change} onClear={clear} />
        ) : (
          <View className="gap-1">
            <Text className="text-xs font-semibold text-muted">InfiniteTag</Text>
            <View className="h-12 flex-row items-center rounded-xl border border-outline/50 bg-surface px-3">
              <Text className="pr-1 text-sm font-bold text-muted">$</Text>
              <TextInput
                accessibilityLabel="InfiniteTag"
                value={handle}
                onChangeText={(next) => {
                  setError("");
                  setHandle(next);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={41}
                className="h-full flex-1 py-0 text-[16px] text-ink"
              />
            </View>
            <Text className="text-xs leading-5 text-muted">É o nome de usuário do app InfinitePay. O checkout externo precisa estar ativo lá; a cobrança aceita Pix ou cartão em até 12x.</Text>
          </View>
        )}

        <View className="flex-row items-center justify-between gap-4 rounded-xl border border-outline/40 bg-surface p-4">
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-1.5">
              <Image source={starMark} tintColor={colors.success} style={{ width: 16, height: 16 }} />
              <Text className="text-sm font-bold text-ink">Definir como meio principal</Text>
            </View>
            <Text className="text-xs leading-5 text-muted">Este meio será usado como padrão ao criar novas cobranças.</Text>
          </View>
          <Switch
            accessibilityLabel="Definir como meio principal"
            value={makeDefault}
            trackColor={{ true: colors.primaryStrong, false: undefined }}
            onValueChange={(next) => {
              defaultTouched.current = true;
              setMakeDefault(next);
            }}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-danger-soft p-4 text-danger">
            {error}
          </Text>
        ) : null}

        {errorStatus === 422 && provider === PaymentProvider.InfinitePay ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir configurações da InfinitePay"
            onPress={() => void Linking.openURL(INFINITEPAY_CHECKOUT_URL)}
            className="min-h-11 items-center justify-center rounded-xl border border-primary/40 bg-primary-soft/30"
          >
            <Text className="text-sm font-bold text-primary-strong">Abrir configurações da InfinitePay</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 border-t border-outline/30 bg-surface/95 px-5 pb-8 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Salvar meio de pagamento"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void save()}
          className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-60" : ""}`}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Image source={checkMark} tintColor={colors.onPrimary} style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-on-primary">Salvar meio de pagamento</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
