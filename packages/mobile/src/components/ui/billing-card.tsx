import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import {
  type BadgeTone,
  type BillingSummary,
  Direction,
  billingBadges,
  billingCategoryColor,
  billingCategoryLabel,
  billingDueLabel,
  billingShareAction,
  formatMoney,
} from "@receivy/common";
import { CategoryIcon } from "@/components/ui/category-icon";
import { useThemeColors } from "@/theme/colors";

const shareMark = require("../../../assets/images/auth/share.svg");

const BADGE_CLASS: Record<BadgeTone, { box: string; text: string }> = {
  danger: { box: "bg-danger-soft", text: "text-danger" },
  info: { box: "bg-primary-soft", text: "text-primary-strong" },
  warning: { box: "bg-warning-soft", text: "text-warning" },
  success: { box: "bg-success-soft", text: "text-success" },
  neutral: { box: "bg-surface-muted", text: "text-muted" },
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** `2026-10-20` → `20/out`, the compact date the card shows next to the amount. */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");

  if (!month || !day) {
    return date;
  }

  return `${day}/${MONTHS[Number(month) - 1] ?? month}`;
}

function occurrenceLine(billing: BillingSummary): string | null {
  if (billing.state === "ended") {
    const last = billing.endDate ?? billing.nextDueDate;

    return last ? `Última ${shortDate(last)}` : null;
  }

  return billing.nextDueDate ? `Vencimento ${shortDate(billing.nextDueDate)}` : null;
}

type BillingCardProps = {
  billing: BillingSummary;
  today: string;
  onShare: (billing: BillingSummary) => void;
  onOpen: (billing: BillingSummary) => void;
};

/** One billing on the list: category tile, title, amount and due label, badges, and the share action in the footer. */
export function BillingCard({ billing, today, onShare, onOpen }: BillingCardProps) {
  const colors = useThemeColors();
  const dueLabel = billingDueLabel(billing, today);
  const overdue = dueLabel.startsWith("Atrasado");
  const badges = billingBadges(billing);
  const occurrence = occurrenceLine(billing);
  const canShare = billingShareAction(billing) !== null;
  const payable = billing.direction === Direction.Payable;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cobrança ${billing.description}`}
      onPress={() => onOpen(billing)}
      className="overflow-hidden rounded-[20px] border border-outline bg-surface"
    >
      <View className="flex-row items-center gap-3 p-4">
        <View className="h-10 w-10 items-center justify-center rounded-[14px]" style={{ backgroundColor: `${billingCategoryColor(billing.category)}18` }}>
          <CategoryIcon category={billing.category} />
        </View>

        <View className="min-w-0 flex-1">
          <Text className="font-sans text-[15px] font-semibold text-ink" numberOfLines={1}>
            {billing.description}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-muted" numberOfLines={1}>
            {billingCategoryLabel(billing.category)} · {payable ? "a pagar" : "a receber"}
          </Text>
        </View>

        <View className="items-end">
          <Text className={`font-display text-[17px] font-bold ${payable ? "text-payable" : "text-ink"}`}>{formatMoney(billing.total)}</Text>
          <Text className={`mt-0.5 font-sans text-[11px] font-medium ${overdue ? "text-payable" : "text-muted"}`}>{dueLabel}</Text>
        </View>
      </View>

      {badges.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 px-4 pb-3.5">
          {badges.map((badge) => (
            <View key={badge.label} className={`h-6 justify-center rounded-lg px-2.5 ${BADGE_CLASS[badge.tone].box}`}>
              <Text className={`font-sans text-[11px] font-semibold ${BADGE_CLASS[badge.tone].text}`}>{badge.label}</Text>
            </View>
          ))}
        </View>
      )}

      {(occurrence || canShare) && (
        <View className="flex-row items-center justify-between border-t border-outline/60 px-4 py-3">
          <Text className="font-sans text-[11.5px] text-muted">{occurrence ?? ""}</Text>

          {canShare && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Compartilhar"
              onPress={() => onShare(billing)}
              className="h-8 flex-row items-center gap-1.5 rounded-[10px] border border-outline px-3"
            >
              <Image source={shareMark} tintColor={colors.muted} style={{ width: 13, height: 13 }} />
              <Text className="font-sans text-xs font-bold text-ink">Compartilhar</Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}
