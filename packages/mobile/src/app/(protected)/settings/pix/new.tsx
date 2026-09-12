import { useLocalSearchParams, useRouter } from "expo-router";
import { PixKeyFormScreen } from "@/components/forms/pix-key-form-screen";

export default function NewPixKeyRoute() {
  const router = useRouter();
  const { returnTo, required } = useLocalSearchParams<{ returnTo?: string; required?: string }>();

  return (
    <PixKeyFormScreen
      returnTo={returnTo}
      required={required === "1"}
      onSaved={() => {
        // The form already handed the key to the parked draft; the billing screen
        // is two hops down, so the whole side trip is dismissed at once.
        if (returnTo === "new-billing") {
          router.dismissTo("/charges/new");
          return;
        }

        router.back();
      }}
    />
  );
}
