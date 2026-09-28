import { Pressable, Text, View } from "react-native";
import {
  type BadgeTone,
  type BillingSummary,
  Direction,
  billingCardSubtitle,
  billingCategoryColor,
  billingChips,
  billingNextLabel,
  formatMoney,
} from "@receivy/common";
import { CategoryIcon } from "@/components/ui/category-icon";

const BADGE_CLASS: Record<BadgeTone, { box: string; text: string }> = {
  danger: { box: "bg-danger-soft", text: "text-danger" },
  info: { box: "bg-primary-soft", text: "text-primary-strong" },
  warning: { box: "bg-warning-soft", text: "text-warning" },
  success: { box: "bg-success-soft", text: "text-success" },
  neutral: { box: "bg-surface-muted", text: "text-muted" },
};

type BillingCardProps = {
  billing: BillingSummary;
  today: string;
  onOpen: (billing: BillingSummary) => void;
};

/** Design 8b: one billing in two lines, category tile, title, amount and next due date, then its chips. Sharing lives on the detail. */
export function BillingCard({ billing, today, onOpen }: BillingCardProps) {
  const next = billingNextLabel(billing, today);
  const chips = billingChips(billing, today);
  const payable = billing.type === Direction.Payable;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conta ${billing.description}`}
      onPress={() => onOpen(billing)}
      className="gap-2.5 rounded-[18px] border border-outline bg-surface p-3.5"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-[12px]" style={{ backgroundColor: `${billingCategoryColor(billing.category)}18` }}>
          <CategoryIcon category={billing.category} />
        </View>

        <View className="min-w-0 flex-1">
          <Text className="font-sans text-[15px] font-semibold text-ink" numberOfLines={1}>
            {billing.description}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-muted" numberOfLines={1}>
            {billingCardSubtitle(billing)}
          </Text>
        </View>

        <View className="items-end">
          <Text className={`font-display text-base font-bold ${payable ? "text-payable" : "text-ink"}`}>{formatMoney(billing.total)}</Text>
          <Text className={`mt-0.5 font-sans text-[11px] font-medium ${BADGE_CLASS[next.tone].text}`}>{next.label}</Text>
        </View>
      </View>

      {chips.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {chips.map((chip) => (
            <View key={chip.label} className={`h-6 justify-center rounded-lg px-2 ${BADGE_CLASS[chip.tone].box}`}>
              <Text className={`font-sans text-[11px] font-semibold ${BADGE_CLASS[chip.tone].text}`}>{chip.label}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}
