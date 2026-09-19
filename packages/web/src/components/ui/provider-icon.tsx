import { PaymentProvider, type PixKeyType } from "@receivy/common";
import { Infinity as InfinityIcon, Landmark } from "lucide-react";
import { PixTypeIcon } from "@/components/ui/pix-type-icon";

type ProviderIconProps = { method: { provider: PaymentProvider; kind: PixKeyType | null }; size?: number; className?: string };

/** The icon of a payment method: the Pix key kind, the InfinitePay mark, or the PagBank mark. */
export function ProviderIcon({ method, size = 18, className }: ProviderIconProps) {
  if (method.provider === PaymentProvider.PagSeguro) {
    return <Landmark size={size} aria-hidden="true" className={className} />;
  }

  if (method.provider === PaymentProvider.InfinitePay || !method.kind) {
    return <InfinityIcon size={size} aria-hidden="true" className={className} />;
  }

  return <PixTypeIcon type={method.kind} size={size} className={className} />;
}
