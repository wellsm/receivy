import { pixKeyField, type PixKeyType } from "@receivy/common";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ACTIVE_TINT, MUTED_TINT } from "@/theme/colors";

type PixKeyFieldsProps = {
  type: PixKeyType;
  /** The key as the user sees it; the parent formats what `onChangeKey` hands back. */
  value: string;
  disabled?: boolean;
  onPickType: (type: PixKeyType) => void;
  onChangeKey: (raw: string) => void;
  onClear: () => void;
};

const TYPES: { value: PixKeyType; label: string; wide?: boolean }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "phone", label: "Celular" },
  { value: "email", label: "E-mail" },
  { value: "random", label: "Chave aleatória", wide: true },
];

export const PIX_TYPE_ICONS: Record<PixKeyType, number> = {
  cpf: require("../../../assets/images/auth/id-card.svg"),
  cnpj: require("../../../assets/images/auth/building.svg"),
  phone: require("../../../assets/images/auth/phone.svg"),
  email: require("../../../assets/images/auth/mail.svg"),
  random: require("../../../assets/images/auth/key.svg"),
};

const plusMark = require("../../../assets/images/auth/plus.svg");

const KEYBOARDS = {
  numeric: "number-pad",
  tel: "phone-pad",
  email: "email-address",
  text: "default",
} as const;

/** The key type chips plus the masked key input, shared by the Pix key form and the conta a pagar form. */
export function PixKeyFields({ type, value, disabled = false, onPickType, onChangeKey, onClear }: PixKeyFieldsProps) {
  const [focused, setFocused] = useState(false);
  const spec = pixKeyField(type);

  async function paste() {
    const text = await Clipboard.getStringAsync().catch(() => "");

    if (!text) {
      return;
    }

    onChangeKey(text);
  }

  return (
    <>
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
                accessibilityState={{ checked: active, disabled }}
                disabled={disabled}
                onPress={() => onPickType(option.value)}
                className={`min-h-[76px] items-center justify-center gap-1 rounded-xl border bg-surface p-3 ${option.wide ? "w-[65.5%] flex-row gap-1.5" : "w-[31.5%]"} ${
                  active ? "border-2 border-primary" : "border-outline/60"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <Image source={PIX_TYPE_ICONS[option.value]} tintColor={active ? ACTIVE_TINT : MUTED_TINT} style={{ width: 22, height: 22 }} />
                <Text className="text-xs font-bold text-ink">{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-semibold text-ink">{spec.label}</Text>
        <View className="h-[52px] flex-row items-center rounded-xl border border-outline bg-surface pl-3.5 pr-2">
          <Image source={PIX_TYPE_ICONS[type]} tintColor={MUTED_TINT} style={{ width: 20, height: 20 }} />
          <TextInput
            accessibilityLabel={spec.label}
            editable={!disabled}
            placeholder={spec.placeholder}
            placeholderTextColor={MUTED_TINT}
            keyboardType={KEYBOARDS[spec.keyboard]}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            value={value}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChangeText={onChangeKey}
            className="h-full flex-1 px-3 py-0 text-[16px] tracking-wide text-primary-strong"
          />
          {focused && value ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Limpar" disabled={disabled} onPress={onClear} className="h-9 w-9 items-center justify-center rounded-full">
              <Image source={plusMark} tintColor={MUTED_TINT} style={{ width: 16, height: 16, transform: [{ rotate: "45deg" }] }} />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Colar" disabled={disabled} onPress={() => void paste()} className="h-9 items-center justify-center rounded-full px-2">
              <Text className="text-xs font-bold text-primary">Colar</Text>
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}
