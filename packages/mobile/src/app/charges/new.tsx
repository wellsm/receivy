import { useRouter } from "expo-router";
import { BillingFormScreen } from "@/components/billing-form-screen";

export default function NewChargeRoute() {
  const router = useRouter();

  return (
    <BillingFormScreen
      onBack={() => router.back()}
      onSaved={(billing) => router.replace({ pathname: "/charges/created", params: { id: billing.id } })}
      onCreateContact={() => router.push({ pathname: "/people", params: { returnTo: "new-billing" } })}
      onCreatePix={() => router.push({ pathname: "/settings", params: { section: "pix", returnTo: "new-billing" } })}
    />
  );
}
