import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";

export default function EditContactRoute() {
  const router = useRouter();
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();

  return (
    <ContactFormScreen
      contactId={id}
      returnTo={returnTo}
      onSaved={() => {
        // The billing form sent the user here to register the key of whoever
        // receives; the whole side trip is dismissed at once, draft and all.
        if (returnTo === "new-billing") {
          router.dismissTo("/billings/new");

          return;
        }

        router.back();
      }}
    />
  );
}
