import { pixKeyField, type PaymentMethod, type PaymentMethodInput, type PixKeyType } from "@receivy/common";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { profileStore, type ProfileStore } from "@/account/profile";
import { SafeAreaView } from "@/components/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { patchDraft } from "@/financial/draft-store";
import { ACTIVE_TINT, MUTED_TINT } from "./tab-bar";

type PixKeyFormClient = Pick<FinancialClient, "paymentMethods" | "savePaymentMethod" | "defaultPaymentMethod">;

type PixKeyFormScreenProps = {
  client?: PixKeyFormClient;
  profile?: Pick<ProfileStore, "load">;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  required?: boolean;
  onSaved?: (method: PaymentMethod) => void;
};

const TYPES: { value: PixKeyType; label: string }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "phone", label: "Celular" },
  { value: "email", label: "E-mail" },
  { value: "random", label: "Chave aleatória" },
];

const KEYBOARDS = {
  numeric: "number-pad",
  tel: "phone-pad",
  email: "email-address",
  text: "default",
} as const;

const INTRO = "A chave aparece no link de pagamento. O pagamento acontece no banco.";
const REQUIRED_NOTICE = "Você precisa de uma chave Pix para criar cobranças.";
const SAVE_ERROR = "Não foi possível salvar a chave Pix.";
const EMPTY_ERROR = "Informe a chave Pix.";

const FIELD_CLASS = "min-h-12 flex-1 rounded-xl border border-outline/60 bg-surface px-3 text-ink";

/** The Pix key form on its own screen, reached from the key list or the billing gate. */
export function PixKeyFormScreen({ client = financialClient, profile = profileStore, returnTo, required = false, onSaved }: PixKeyFormScreenProps) {
  const [type, setType] = useState<PixKeyType>("email");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [label, setLabel] = useState("");
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

    const input: PaymentMethodInput = { pixKeyType: type, pixKey, ...(label ? { label } : {}) };

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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false}>
        <Text className="leading-6 text-muted">{INTRO}</Text>

        {required ? <Text className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">{REQUIRED_NOTICE}</Text> : null}

        <View className="gap-3 rounded-3xl border border-outline/40 bg-surface p-5">
          <Text className="text-sm font-bold text-ink">Tipo de chave</Text>

          <View accessibilityRole="radiogroup" accessibilityLabel="Tipo de chave" className="flex-row flex-wrap gap-2">
            {TYPES.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: type === option.value }}
                onPress={() => pick(option.value)}
                className={`min-h-11 justify-center rounded-full border px-4 ${type === option.value ? "border-primary bg-primary-soft" : "border-outline/60 bg-surface"}`}
              >
                <Text className={`text-sm font-bold ${type === option.value ? "text-primary-strong" : "text-muted"}`}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
          <View className="gap-1.5">
            <Text className="text-sm font-bold text-ink">{spec.label}</Text>

            <View className="flex-row items-center gap-2">
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
                className={FIELD_CLASS}
              />

              {focused && value ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Limpar"
                  onPress={clear}
                  className="min-h-11 min-w-11 items-center justify-center rounded-xl border border-outline/60 px-3"
                >
                  <Text className="font-bold text-muted">X</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Colar"
                  onPress={() => void paste()}
                  className="min-h-11 items-center justify-center rounded-xl border border-outline/60 px-3"
                >
                  <Text className="font-bold text-primary">Colar</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View className="gap-1.5">
            <Text className="text-sm font-bold text-ink">Banco (opcional)</Text>

            <TextInput
              accessibilityLabel="Banco (opcional)"
              placeholder="Nubank"
              placeholderTextColor={MUTED_TINT}
              maxLength={120}
              value={label}
              onChangeText={setLabel}
              className="min-h-12 rounded-xl border border-outline/60 bg-surface px-3 text-ink"
            />
          </View>

          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-sm font-semibold text-ink">Definir como chave principal</Text>

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
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View className="border-t border-outline/40 bg-surface px-5 pb-6 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Salvar chave Pix"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void save()}
          className="min-h-12 items-center justify-center rounded-xl bg-primary"
        >
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text className="font-bold text-white">Salvar chave Pix</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
