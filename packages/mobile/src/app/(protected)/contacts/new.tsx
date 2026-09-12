import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";

export default function NewContactRoute() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

  return (
    <ContactFormScreen
      returnTo={returnTo}
      onSaved={() => {
        // The form already handed the contact to the parked draft; the billing
        // screen is two hops down, so the whole side trip is dismissed at once.
        if (returnTo === "new-billing") {
          router.dismissTo("/charges/new");
          return;
        }

        router.back();
      }}
    />
  );
}
