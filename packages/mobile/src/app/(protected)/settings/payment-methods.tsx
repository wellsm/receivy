import { useLocalSearchParams, useRouter } from "expo-router";
import { PaymentMethodsScreen } from "@/components/screens/payment-methods-screen";

export default function PaymentMethodsRoute() {
  const router = useRouter();
  const { returnTo, required } = useLocalSearchParams<{ returnTo?: string; required?: string }>();
  // The billing form parked a draft before sending the user here; the method form
  // one hop down is the screen that fills it in, so the trip carries over.
  const toBilling = returnTo === "new-billing";
  const gated = required === "1";

  return (
    <PaymentMethodsScreen
      required={gated}
      onNewMethod={() =>
        router.push({
          pathname: "/settings/payment-methods/new",
          params: { ...(toBilling ? { returnTo: "new-billing" } : {}), ...(gated ? { required: "1" } : {}) },
        })
      }
    />
  );
}
