import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export const CODE_LENGTH = 6;

type CodeBoxesProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Six visual boxes backed by one real TextInput, so paste, autofill from SMS/e-mail and
 * screen readers keep working. The input sits over the boxes with zero opacity.
 */
export function CodeBoxes({ value, onChange, onSubmit, disabled = false, autoFocus = true }: CodeBoxesProps) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? "");
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <Pressable accessible={false} onPress={() => input.current?.focus()} className="relative">
      <View className="flex-row justify-between gap-2">
        {digits.map((digit, index) => {
          const active = focused && index === activeIndex;

          return (
            <View
              key={index}
              className={`h-16 flex-1 items-center justify-center rounded-2xl border bg-surface ${active ? "border-2 border-primary" : "border-outline"}`}
            >
              <Text className="text-2xl font-extrabold text-ink">{digit}</Text>
              {active && digit === "" && <View className="absolute h-7 w-0.5 bg-ink" />}
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        accessibilityLabel="Código de 6 dígitos"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        caretHidden
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={CODE_LENGTH}
        onBlur={() => setFocused(false)}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onSubmitEditing={onSubmit}
        textContentType="oneTimeCode"
        value={value}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
      />
    </Pressable>
  );
}
