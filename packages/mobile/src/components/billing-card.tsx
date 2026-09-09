import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import {
  type BadgeTone,
  type BillingCategory,
  type BillingSummary,
  billingBadges,
  billingDueLabel,
  billingShareAction,
  formatMoney,
} from "@receivy/common";
import { ACTIVE_TINT, MUTED_TINT } from "./tab-bar";

const CATEGORY_ICONS = {
  food: require("../../assets/images/auth/category-food.svg"),
  transport: require("../../assets/images/auth/category-transport.svg"),
  groceries: require("../../assets/images/auth/category-groceries.svg"),
  subscription: require("../../assets/images/auth/category-subscription.svg"),
  loan: require("../../assets/images/auth/category-loan.svg"),
  housing: require("../../assets/images/auth/category-housing.svg"),
  travel: require("../../assets/images/auth/category-travel.svg"),
  other: require("../../assets/images/auth/category-other.svg"),
} satisfies Record<BillingCategory, unknown>;

const shareMark = require("../../assets/images/auth/share.svg");
const editMark = require("../../assets/images/auth/edit.svg");

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-800",
  success: "bg-primary-soft/50 text-primary-strong",
  neutral: "bg-surface-muted text-muted",
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
  onEdit: (billing: BillingSummary) => void;
  onOpen: (billing: BillingSummary) => void;
};

/** One billing on the list: category, description, due label, badges, amount and its two actions. */
export function BillingCard({ billing, today, onShare, onEdit, onOpen }: BillingCardProps) {
  const dueLabel = billingDueLabel(billing, today);
  const overdue = dueLabel.startsWith("Atrasado");
  const badges = billingBadges(billing);
  const occurrence = occurrenceLine(billing);
  const canShare = billingShareAction(billing) !== null;
  const canEdit = billing.state !== "ended";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cobrança ${billing.description}`}
      onPress={() => onOpen(billing)}
      className="gap-3 rounded-2xl border border-outline/40 bg-surface p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft/50">
          <Image source={CATEGORY_ICONS[billing.category] ?? CATEGORY_ICONS.other} tintColor={ACTIVE_TINT} style={{ width: 20, height: 20 }} />
        </View>

        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm font-bold text-ink" numberOfLines={1}>
              {billing.description}
            </Text>
            <Text className={`text-xs font-semibold ${overdue ? "text-red-700" : "text-muted"}`}>{dueLabel}</Text>
          </View>

          {badges.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">
              {badges.map((badge) => (
                <Text key={badge.label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[badge.tone]}`}>
                  {badge.label}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>

      <View className="flex-row items-center justify-between border-t border-outline/30 pt-3">
        <View>
          <Text className="text-lg font-extrabold tracking-tight text-primary">{formatMoney(billing.total)}</Text>
          {occurrence && <Text className="text-[11px] text-muted">{occurrence}</Text>}
        </View>

        <View className="flex-row gap-2">
          {canShare && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Compartilhar"
              onPress={() => onShare(billing)}
              className="min-h-10 flex-row items-center gap-1.5 rounded-lg bg-primary-soft/40 px-3"
            >
              <Image source={shareMark} tintColor={ACTIVE_TINT} style={{ width: 14, height: 14 }} />
              <Text className="text-xs font-bold text-primary-strong">Compartilhar</Text>
            </Pressable>
          )}

          {canEdit && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Editar"
              onPress={() => onEdit(billing)}
              className="min-h-10 flex-row items-center gap-1.5 rounded-lg bg-surface-muted px-3"
            >
              <Image source={editMark} tintColor={MUTED_TINT} style={{ width: 14, height: 14 }} />
              <Text className="text-xs font-bold text-ink">Editar</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}
