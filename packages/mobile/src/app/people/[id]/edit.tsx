import { useLocalSearchParams, useRouter } from "expo-router";
import { ContactFormScreen } from "@/components/contact-form-screen";

export default function EditContactRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ContactFormScreen personId={id} onSaved={() => router.back()} />;
}
