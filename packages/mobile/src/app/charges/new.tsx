import { useRouter } from "expo-router";
import { BillingFormScreen } from "@/components/billing-form-screen";

export default function NewChargeRoute() {
  const router = useRouter();

  return (
    <BillingFormScreen
      onSaved={(billing) => router.replace({ pathname: "/charges/created", params: { id: billing.id } })}
      onCreateContact={() => router.push({ pathname: "/people", params: { returnTo: "new-billing" } })}
      onCreatePix={(required) =>
        router.push({ pathname: "/settings/pix", params: { returnTo: "new-billing", ...(required ? { required: "1" } : {}) } })
      }
    />
  );
}
