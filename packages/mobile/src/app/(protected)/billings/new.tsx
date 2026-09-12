import { useRouter } from "expo-router";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

export default function NewChargeRoute() {
  const router = useRouter();

  return (
    <BillingFormScreen
      onSaved={(billing) => router.replace({ pathname: "/billings/[id]", params: { id: billing.id } })}
      // The side trips go straight to the form screens: the lists have nothing to
      // add when the user already knows they are registering something new.
      onCreateContact={() => router.push("/people/new?returnTo=new-billing")}
      onCreatePix={(required) =>
        router.push({ pathname: "/settings/pix/new", params: { returnTo: "new-billing", ...(required ? { required: "1" } : {}) } })
      }
    />
  );
}
