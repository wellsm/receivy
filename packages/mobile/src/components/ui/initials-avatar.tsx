import { Text, View } from "react-native";

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

type InitialsAvatarProps = {
  name: string;
  /** Diameter in pixels; the letter scales with it. */
  size?: number;
  inverted?: boolean;
};

/** Round monogram used by contact chips, the picker and the split rows. */
export function InitialsAvatar({ name, size = 28, inverted = false }: InitialsAvatarProps) {
  return (
    <View
      className={`items-center justify-center rounded-full ${inverted ? "bg-primary" : "bg-primary-soft/60"}`}
      style={{ width: size, height: size }}
    >
      <Text className={`font-extrabold ${inverted ? "text-on-primary" : "text-primary-strong"}`} style={{ fontSize: size * 0.42 }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}
