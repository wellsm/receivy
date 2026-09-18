import { pixKeyField, type PaymentMethod, type PaymentMethodInput, PixKeyType } from "@receivy/common";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { profileStore, type ProfileStore } from "@/account/profile";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { SafeAreaView } from "@/components/ui/safe-area-view";
import { financialClient, type FinancialClient } from "@/financial/client";
import { patchDraft } from "@/financial/draft-store";
import { useThemeColors } from "@/theme/colors";

type PixKeyFormClient = Pick<FinancialClient, "paymentMethods" | "savePaymentMethod" | "defaultPaymentMethod">;

type PixKeyFormScreenProps = {
  client?: PixKeyFormClient;
  profile?: Pick<ProfileStore, "load">;
  /** `new-billing` when the billing form sent the user here. */
  returnTo?: string;
  required?: boolean;
  onSaved?: (method: PaymentMethod) => void;
};

const starMark = require("../../../assets/images/auth/star.svg");
const checkMark = require("../../../assets/images/auth/check.svg");

const REQUIRED_NOTICE = "Você precisa de uma chave Pix para criar cobranças.";
const SAVE_ERROR = "Não foi possível salvar a chave Pix.";
const EMPTY_ERROR = "Informe a chave Pix.";

/** The Pix key form on its own screen, reached from the key list or the billing gate. */
export function PixKeyFormScreen({ client = financialClient, profile = profileStore, returnTo, required = false, onSaved }: PixKeyFormScreenProps) {
  const colors = useThemeColors();
  const [type, setType] = useState<PixKeyType>(PixKeyType.Email);
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [makeDefault, setMakeDefault] = useState(true);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
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
        {required ? <Text className="rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning">{REQUIRED_NOTICE}</Text> : null}

        <PixKeyFields type={type} value={value} onPickType={pick} onChangeKey={change} onClear={clear} />

        <View className="flex-row items-center justify-between gap-4 rounded-xl border border-outline/40 bg-surface p-4">
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-1.5">
              <Image source={starMark} tintColor={colors.success} style={{ width: 16, height: 16 }} />
              <Text className="text-sm font-bold text-ink">Definir como chave principal</Text>
            </View>
            <Text className="text-xs leading-5 text-muted">Esta chave será usada como padrão ao criar novas cobranças e links Pix.</Text>
          </View>
          <Switch
            accessibilityLabel="Definir como chave principal"
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
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Image source={checkMark} tintColor={colors.onPrimary} style={{ width: 18, height: 18 }} />
              <Text className="text-sm font-bold text-on-primary">Salvar Chave Pix</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
