import { pixKeyField, type PaymentMethod, type PaymentMethodInput, type PixKeyType } from "@receivy/common";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { profileStore, type ProfileStore } from "@/account/profile";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { patchDraft } from "@/financial/draft-store";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

type PixKeyFormClient = Pick<FinancialClient, "paymentMethods" | "savePaymentMethod" | "defaultPaymentMethod">;

type PixKeyFormScreenProps = {
  client?: PixKeyFormClient;
  profile?: Pick<ProfileStore, "load">;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  required?: boolean;
  onSaved?: (method: PaymentMethod) => void;
};

const TYPES: { value: PixKeyType; label: string; wide?: boolean }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "phone", label: "Celular" },
  { value: "email", label: "E-mail" },
  { value: "random", label: "Chave aleatória", wide: true },
];

const ICONS: Record<PixKeyType, number> = {
  cpf: require("../../../assets/images/auth/id-card.svg"),
  cnpj: require("../../../assets/images/auth/building.svg"),
  phone: require("../../../assets/images/auth/phone.svg"),
  email: require("../../../assets/images/auth/mail.svg"),
  random: require("../../../assets/images/auth/key.svg"),
};

const starMark = require("../../../assets/images/auth/star.svg");
const checkMark = require("../../../assets/images/auth/check.svg");
const plusMark = require("../../../assets/images/auth/plus.svg");

const KEYBOARDS = {
  numeric: "number-pad",
  tel: "phone-pad",
  email: "email-address",
  text: "default",
} as const;

const REQUIRED_NOTICE = "Você precisa de uma chave Pix para criar cobranças.";
const SAVE_ERROR = "Não foi possível salvar a chave Pix.";
const EMPTY_ERROR = "Informe a chave Pix.";

/** The Pix key form on its own screen, reached from the key list or the billing gate. */
export function PixKeyFormScreen({ client = financialClient, profile = profileStore, returnTo, required = false, onSaved }: PixKeyFormScreenProps) {
  const [type, setType] = useState<PixKeyType>("email");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);
  const [accountEmail, setAccountEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        if (live && user.email) {
          setAccountEmail(user.email);
        }
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [profile]);

  const spec = pixKeyField(type);
  // Most people register their own e-mail, so an untouched e-mail field shows the
  // account e-mail. It stays editable: typing — or clearing it — takes over, and
  // picking another type starts over.
  const value = type === "email" && !key && !touched ? accountEmail : key;

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

  async function paste() {
    setError("");

    const text = await Clipboard.getStringAsync().catch(() => "");

    if (!text) {
      return;
    }

    change(text);
  }

  function clear() {
    setTouched(true);
    setKey("");
  }

  async function save() {
    setError("");

    const pixKey = spec.unformat(value);

    // The web input carries `required`, so the browser blocks an empty submit.
    // On mobile the guard has to be here, or the API answers with a generic
    // failure that never names the real problem.
    if (!pixKey) {
      setError(EMPTY_ERROR);
      return;
    }

    setBusy(true);

    const input: PaymentMethodInput = { pixKeyType: type, pixKey };

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["bottom"]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-5 pb-32 pt-5" showsVerticalScrollIndicator={false}>
        {required ? <Text className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{REQUIRED_NOTICE}</Text> : null}

        <View className="gap-2">
          <Text className="text-sm font-semibold text-ink">Tipo de Chave</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Tipo de chave" className="flex-row flex-wrap justify-between gap-y-2">
            {TYPES.map((option) => {
              const active = type === option.value;

              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: active }}
                  onPress={() => pick(option.value)}
                  className={`min-h-[76px] items-center justify-center gap-1 rounded-xl border bg-surface p-3 ${option.wide ? "w-[65.5%] flex-row gap-1.5" : "w-[31.5%]"} ${
                    active ? "border-2 border-primary" : "border-outline/60"
                  }`}
                >
                  <Image source={ICONS[option.value]} tintColor={active ? ACTIVE_TINT : MUTED_TINT} style={{ width: 22, height: 22 }} />
                  <Text className="text-xs font-bold text-ink">{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-sm font-semibold text-ink">{spec.label}</Text>
          <View className="h-[52px] flex-row items-center rounded-xl border border-outline bg-surface pl-3.5 pr-2">
            <Image source={ICONS[type]} tintColor={MUTED_TINT} style={{ width: 20, height: 20 }} />
            <TextInput
              accessibilityLabel={spec.label}
              placeholder={spec.placeholder}
              placeholderTextColor={MUTED_TINT}
              keyboardType={KEYBOARDS[spec.keyboard]}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              value={value}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChangeText={change}
              className="h-full flex-1 px-3 py-0 text-[16px] tracking-wide text-primary-strong"
            />
            {focused && value ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Limpar" onPress={clear} className="h-9 w-9 items-center justify-center rounded-full">
                <Image source={plusMark} tintColor={MUTED_TINT} style={{ width: 16, height: 16, transform: [{ rotate: "45deg" }] }} />
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Colar" onPress={() => void paste()} className="h-9 items-center justify-center rounded-full px-2">
                <Text className="text-xs font-bold text-primary">Colar</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View className="flex-row items-center justify-between gap-4 rounded-xl border border-outline/40 bg-surface p-4">
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-1.5">
              <Image source={starMark} tintColor="#006c49" style={{ width: 16, height: 16 }} />
              <Text className="text-sm font-bold text-ink">Definir como chave principal</Text>
            </View>
            <Text className="text-xs leading-5 text-muted">Esta chave será usada como padrão ao criar novas cobranças e links Pix.</Text>
          </View>
          <Switch
            accessibilityLabel="Definir como chave principal"
            value={makeDefault}
            trackColor={{ true: ACTIVE_TINT, false: undefined }}
            onValueChange={(next) => {
              defaultTouched.current = true;
              setMakeDefault(next);
            }}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 border-t border-outline/30 bg-surface/95 px-5 pb-8 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Salvar chave Pix"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void save()}
          className={`h-[52px] flex-row items-center justify-center gap-2 rounded-xl bg-primary ${busy ? "opacity-60" : ""}`}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Image source={checkMark} tintColor="#FFFFFF" style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-white">Salvar Chave Pix</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
