import { useLocalSearchParams, useRouter } from "expo-router";
import { PaymentMethodFormScreen } from "@/components/forms/payment-method-form-screen";

export default function NewPaymentMethodRoute() {
  const router = useRouter();
  const { returnTo, required } = useLocalSearchParams<{ returnTo?: string; required?: string }>();

  return (
    <PaymentMethodFormScreen
      returnTo={returnTo}
      required={required === "1"}
      onSaved={() => {
        // The form already handed the key to the parked draft; the billing screen
        // is two hops down, so the whole side trip is dismissed at once.
        if (returnTo === "new-billing") {
          router.dismissTo("/billings/new");

          return;
        }

        router.back();
      }}
    />
  );
}
