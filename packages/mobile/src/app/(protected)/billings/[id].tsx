import { useLocalSearchParams, useRouter } from "expo-router";
import { BillingDetailScreen } from "@/components/screens/billing-detail-screen";

export default function BillingRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <BillingDetailScreen
      id={id}
      onOpenCharge={(chargeId) => router.push({ pathname: "/charges/[id]", params: { id: chargeId } })}
      onEdit={() => router.push({ pathname: "/billings/[id]/edit", params: { id } })}
    />
  );
}
