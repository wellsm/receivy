import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";

export default function EditContactRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ContactFormScreen contactId={id} onSaved={() => router.back()} />;
}
