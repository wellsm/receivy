import { useState } from "react";
import { Image } from "expo-image";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { BILLING_CATEGORIES, billingCategoryColor, billingCategoryLabel, type BillingCategory } from "@receivy/common";
import { CategoryIcon } from "@/components/ui/category-icon";
import { useThemeColors } from "@/theme/colors";

const chevronMark = require("../../../assets/images/auth/chevron.svg");
const checkMark = require("../../../assets/images/auth/check.svg");

type CategorySelectProps = {
  value: BillingCategory;
  onSelect: (category: BillingCategory) => void;
  disabled?: boolean;
};

/** Select-shaped trigger over a bottom sheet: the eight categories never fit a row of chips. */
export function CategorySelect({ value, onSelect, disabled }: CategorySelectProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  function choose(category: BillingCategory) {
    setOpen(false);
    onSelect(category);
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Categoria"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={`h-11 flex-row items-center gap-3 rounded-[14px] border border-outline bg-surface px-3 ${disabled ? "opacity-60" : ""}`}
      >
        <View className="h-7 w-7 items-center justify-center rounded-[9px]" style={{ backgroundColor: `${billingCategoryColor(value)}18` }}>
          <CategoryIcon category={value} size={16} />
        </View>

        <Text className="flex-1 font-sans text-[14px] font-semibold text-ink" numberOfLines={1}>
          {billingCategoryLabel(value)}
        </Text>

        <Image source={chevronMark} tintColor={colors.muted} style={{ width: 14, height: 14, transform: [{ rotate: "90deg" }] }} />
      </Pressable>

      {open && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setOpen(false)}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar categorias" onPress={() => setOpen(false)} className="flex-1 bg-scrim" />

          <View className="gap-4 rounded-t-3xl bg-surface px-5 pb-10 pt-5">
            <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
              Categoria
            </Text>

            <ScrollView contentContainerClassName="gap-1" showsVerticalScrollIndicator={false}>
              {BILLING_CATEGORIES.map((category) => {
                const active = category.value === value;
                const tint = billingCategoryColor(category.value);

                return (
                  <Pressable
                    key={category.value}
                    accessibilityRole="button"
                    accessibilityLabel={category.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => choose(category.value)}
                    className={`h-14 flex-row items-center gap-3 rounded-2xl px-3 ${active ? "bg-surface-muted" : ""}`}
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}1F` }}>
                      <CategoryIcon category={category.value} size={18} />
                    </View>

                    <Text className="flex-1 text-sm font-semibold text-ink">{category.label}</Text>

                    {active && <Image source={checkMark} tintColor={tint} style={{ width: 16, height: 16 }} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      )}
    </View>
  );
}
