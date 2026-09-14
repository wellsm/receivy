import { billingCategoryColor, type BillingCategory } from "@receivy/common";
import { Image } from "expo-image";

const CATEGORY_ICONS = {
  food: require("../../../assets/images/categories/food.svg"),
  transport: require("../../../assets/images/categories/transport.svg"),
  groceries: require("../../../assets/images/categories/groceries.svg"),
  subscription: require("../../../assets/images/categories/subscription.svg"),
  loan: require("../../../assets/images/categories/loan.svg"),
  housing: require("../../../assets/images/categories/housing.svg"),
  travel: require("../../../assets/images/categories/travel.svg"),
  health: require("../../../assets/images/categories/health.svg"),
  education: require("../../../assets/images/categories/education.svg"),
  leisure: require("../../../assets/images/categories/leisure.svg"),
  other: require("../../../assets/images/categories/other.svg"),
} satisfies Record<BillingCategory, unknown>;

type CategoryIconProps = {
  category: BillingCategory;
  size?: number;
  /** Overrides the category tint; only the tab bars and disabled states need that. */
  tint?: string;
};

export function CategoryIcon({ category, size = 20, tint }: CategoryIconProps) {
  return (
    <Image
      source={CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other}
      tintColor={tint ?? billingCategoryColor(category)}
      style={{ width: size, height: size }}
    />
  );
}
