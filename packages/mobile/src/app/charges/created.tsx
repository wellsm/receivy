import { useLocalSearchParams, useRouter } from "expo-router";
import { BillingCreatedScreen } from "@/components/billing-created-screen";

export default function BillingCreatedRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <BillingCreatedScreen
      id={id}
      onOpenCharge={(chargeId) => router.replace({ pathname: "/charges/[id]", params: { id: chargeId } })}
      onBack={() => router.replace("/billings")}
    />
  );
}
