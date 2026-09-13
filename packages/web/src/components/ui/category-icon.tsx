import { billingCategoryColor, type BillingCategory } from "@receivy/common";
import { Car, GraduationCap, Handshake, HeartPulse, House, Plane, Repeat, ShoppingCart, Tag, Ticket, Utensils, type LucideIcon } from "lucide-react";

export const CATEGORY_ICONS: Record<BillingCategory, LucideIcon> = {
  food: Utensils,
  transport: Car,
  groceries: ShoppingCart,
  subscription: Repeat,
  loan: Handshake,
  housing: House,
  travel: Plane,
  health: HeartPulse,
  education: GraduationCap,
  leisure: Ticket,
  other: Tag,
};

type CategoryIconProps = {
  category: BillingCategory;
  size?: number;
  className?: string;
  /** Overrides the category tint; pass `"currentColor"` to inherit the surrounding text colour. */
  color?: string;
};

export function CategoryIcon({ category, size = 20, className, color }: CategoryIconProps) {
  const Icon = CATEGORY_ICONS[category] ?? Tag;

  return <Icon size={size} aria-hidden="true" className={className} color={color ?? billingCategoryColor(category)} />;
}
