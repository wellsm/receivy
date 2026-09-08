import { useRouter } from "expo-router";
import { BillingFormScreen } from "@/components/billing-form-screen";

export default function NewChargeRoute() {
  const router = useRouter();

  return (
    <BillingFormScreen
      onBack={() => router.back()}
      onSaved={(billing) => {
        const first = billing.charges[0];
        if (first) {
          router.replace({ pathname: "/charges/[id]", params: { id: first.id } });
          return;
        }
        router.replace("/billings");
      }}
    />
  );
}
