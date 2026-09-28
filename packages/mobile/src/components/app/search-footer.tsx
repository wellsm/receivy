import { Image } from "expo-image";
import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

const searchMark = require("../../../assets/images/auth/search.svg");
const slidersMark = require("../../../assets/images/auth/sliders.svg");
const plusMark = require("../../../assets/images/auth/plus.svg");

type SearchFooterProps = {
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  /** How many filters differ from the default; the filter button shows it as a badge. */
  filterCount: number;
  onFilter: () => void;
  onCreate: () => void;
};

/** Design 8: the compact footer of Feed and Contas, a search with the filter inside and the + beside it. */
export function SearchFooter({
  placeholder,
  value,
  onChangeText,
  filterCount,
  onFilter,
  onCreate,
}: SearchFooterProps) {
  const colors = useThemeColors();

  return (
    <View className="flex-row items-center gap-2.5 border-t border-outline/60 bg-surface px-3.5 pb-2 pt-2.5">
      <View className="h-16 flex-1 flex-row items-center gap-2 rounded-[14px] bg-surface-muted pl-3.5 pr-1">
        <Image
          source={searchMark}
          tintColor={colors.muted}
          style={{ width: 16, height: 16 }}
        />
        <TextInput
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
          textAlignVertical="center"
          className="h-full flex-1 py-0 font-sans text-[16px] tracking-normal text-ink"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            filterCount ? `Filtros, ${filterCount} ativos` : "Filtros"
          }
          onPress={onFilter}
          className={`h-[34px] w-[34px] items-center justify-center rounded-[10px] ${filterCount ? "bg-primary-soft" : "bg-surface"}`}
        >
          <Image
            source={slidersMark}
            tintColor={filterCount ? colors.primaryStrong : colors.ink}
            style={{ width: 16, height: 16 }}
          />
          {filterCount > 0 && (
            <Text className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center font-sans text-[10px] font-bold text-on-primary">
              {filterCount}
            </Text>
          )}
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nova conta"
        onPress={onCreate}
        className="size-11 items-center justify-center rounded-[14px] bg-primary"
      >
        <Image
          source={plusMark}
          tintColor={colors.onPrimary}
          style={{ width: 20, height: 20 }}
        />
      </Pressable>
    </View>
  );
}
